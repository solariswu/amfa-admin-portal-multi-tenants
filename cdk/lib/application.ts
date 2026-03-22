import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { StringParameter } from "aws-cdk-lib/aws-ssm";

import { CfnOutput, Stack, StackProps, Duration } from "aws-cdk-lib";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

import { WebApplication } from "./webapp";
import { Source } from "aws-cdk-lib/aws-s3-deployment";

import { SSOApiGateway } from "./httpapi";
import { SSOUserPool } from "./userpool";
import {
  hostedUI_domain_prefix,
  project_name,
  amfa_api_base,
  samlproxy_base_url,
} from "../config/config";
import { createPostDeploymentLambda } from "./postDeployment";
import * as path from "path";

export interface AppStackProps extends StackProps {
  siteCertificate: Certificate;
  apiCertificate: Certificate;
  domainName: string | undefined;
  hostedUIDomain: string | undefined;
  hostedZoneId: string | undefined;
  hostedZone: PublicHostedZone;
  assetsPath: string;
  spPortalAssetsPath?: string;
  amfaBaseUrl: string;
}

export class AppStack extends Stack {
  // public readonly spPortalWebApps: { [tenantId: string]: SPPortalWebApp } = {};
  public readonly tenantUserPoolClients: { [tenantId: string]: any } = {};

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    // frontend
    // use the domain created above to create the frontend web app.
    const webapp = new WebApplication(this, props);

    // backend
    // admin http apigateway
    const apigateway = new SSOApiGateway(this, props);

    // userpool creations - application and admin userpools
    const userPool = new SSOUserPool(this, props);

    //using admin userpool as main authorizor
    apigateway.attachAuthorizor(userPool);

    // Import SP portal infrastructure details from SSM Parameter Store
    // These are created by the amfa-service-multi-tenants stack
    const spPortalBucket = StringParameter.valueFromLookup(
      this,
      "/amfa/sp-portal/bucket-name",
    );

    const spPortalDistributionId = StringParameter.valueFromLookup(
      this,
      "/amfa/sp-portal/distribution-id",
    );

    // Import shared Lambda ARNs and KMS key from SSM Parameter Store
    // These are created by the amfa-service-multi-tenants AmfaStack
    const createAuthChallengeLambdaArn = StringParameter.valueFromLookup(
      this,
      "/amfa/lambda/create-auth-challenge-arn",
    );

    const defineAuthChallengeLambdaArn = StringParameter.valueFromLookup(
      this,
      "/amfa/lambda/define-auth-challenge-arn",
    );

    const verifyAuthChallengeLambdaArn = StringParameter.valueFromLookup(
      this,
      "/amfa/lambda/verify-auth-challenge-arn",
    );

    const customEmailSenderLambdaArn = StringParameter.valueFromLookup(
      this,
      "/amfa/lambda/custom-email-sender-arn",
    );

    const customSenderKmsKeyArn = StringParameter.valueFromLookup(
      this,
      "/amfa/kms/custom-sender-key-arn",
    );

    // Create provision-tenant Lambda for tenant provisioning
    const provisionTenantLambda = new Function(this, "ProvisionTenantLambda", {
      functionName: `${project_name}-provision-tenant-${this.region}`,
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(path.join(__dirname, "../lambda/provision-tenant")),
      timeout: Duration.minutes(15),
      memorySize: 512,
      environment: {
        ROOT_DOMAIN_NAME: amfa_api_base || "",
        ACCOUNT_ID: this.account || "",
        AMFATENANT_TABLE: "amfa-tenanttable",
        AMFACONFIG_TABLE: "amfa-configtable",
        ASM_SERVICE_URL: process.env.ASM_SERVICE_URL || "",
        ASM_PORTAL_URL: process.env.ASM_PORTAL_URL || "",
        SP_PORTAL_BUCKET: spPortalBucket, // Imported from SSM
        CLOUDFRONT_DISTRIBUTION_ID: spPortalDistributionId, // Imported from SSM
        // Shared Lambda ARNs for Cognito triggers (imported from SSM)
        CREATE_AUTH_CHALLENGE_LAMBDA_ARN: createAuthChallengeLambdaArn,
        DEFINE_AUTH_CHALLENGE_LAMBDA_ARN: defineAuthChallengeLambdaArn,
        VERIFY_AUTH_CHALLENGE_LAMBDA_ARN: verifyAuthChallengeLambdaArn,
        CUSTOM_EMAIL_SENDER_LAMBDA_ARN: customEmailSenderLambdaArn,
        CUSTOM_SENDER_KMS_KEY_ARN: customSenderKmsKeyArn,
        SAML_PROXY_BASE_URL: samlproxy_base_url || "",
        // SMTP defaults for new tenant provisioning (from tenants-config.json via shell env)
        SMTP_HOST: process.env.SMTP_HOST || "smtp.google.com",
        SMTP_USER: process.env.SMTP_USER || "",
        SMTP_PASS: process.env.SMTP_PASS || "",
        SMTP_PORT: process.env.SMTP_PORT || "587",
        SMTP_SECURE: process.env.SMTP_SECURE || "false",
      },
    });

    // Grant provision-tenant Lambda least-privilege permissions

    // 1. Secrets Manager - Restricted to apersona/* namespace
    provisionTenantLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:apersona/*`,
        ],
      }),
    );

    // Secrets Manager - Write operations for org/tenant credential storage and rollback cleanup
    provisionTenantLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:UpdateSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:TagResource",
          "secretsmanager:DeleteSecret", // Required for rollback cleanup of tenant secrets
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:apersona/*`,
        ],
      }),
    );

    // 2. DynamoDB - Restricted to amfa-* tables
    provisionTenantLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:DescribeTable",
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/amfa-*`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/amfa-*/index/*`,
        ],
      }),
    );

    // DynamoDB - Table creation/deletion (separate for audit trail)
    provisionTenantLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:CreateTable",
          "dynamodb:DeleteTable",
          "dynamodb:TagResource",
          "dynamodb:UntagResource",
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/amfa-*`,
        ],
      }),
    );

    // 3. S3 - Restricted to tenant resource buckets and shared SP portal
    provisionTenantLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
        resources: [
          "arn:aws:s3:::*-login/*",
          "arn:aws:s3:::*-portal/*",
          "arn:aws:s3:::sp-portal-shared-*/*", // Shared SP portal bucket
          "arn:aws:s3:::amfa-service-shared-*/*", // Shared AMFA service bucket
        ],
      }),
    );

    provisionTenantLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [
          "arn:aws:s3:::*-login",
          "arn:aws:s3:::*-portal",
          "arn:aws:s3:::sp-portal-shared-*", // Shared SP portal bucket
          "arn:aws:s3:::amfa-service-shared-*", // Shared AMFA service bucket
        ],
      }),
    );

    // 4. Cognito - Must remain broad (no resource-level permissions supported)
    provisionTenantLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "cognito-idp:CreateUserPool",
          "cognito-idp:UpdateUserPool",
          "cognito-idp:DeleteUserPool",
          "cognito-idp:CreateUserPoolClient",
          "cognito-idp:UpdateUserPoolClient",
          "cognito-idp:DeleteUserPoolClient",
          "cognito-idp:CreateUserPoolDomain",
          "cognito-idp:DeleteUserPoolDomain",
          "cognito-idp:DescribeUserPool",
          "cognito-idp:DescribeUserPoolClient",
          "cognito-idp:CreateIdentityProvider", // For creating OIDC provider
          "cognito-idp:UpdateIdentityProvider",
          "cognito-idp:DeleteIdentityProvider",
          "cognito-idp:DescribeIdentityProvider",
          "cognito-idp:CreateResourceServer", // For creating resource server (amfa/totptoken scope)
          "cognito-idp:CreateGroup",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:SetUserPoolMfaConfig",
          "cognito-idp:TagResource", // Required when creating UserPool with UserPoolTags
        ],
        resources: ["*"], // Cognito doesn't support resource-level permissions
      }),
    );

    // 4b. Lambda - Permission to add invoke permissions for Cognito triggers
    provisionTenantLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["lambda:AddPermission", "lambda:RemovePermission"],
        resources: [`arn:aws:lambda:${this.region}:${this.account}:function:*`],
      }),
    );

    // 4c. KMS - Permission to create grants on the shared custom sender KMS key
    // Required when UpdateUserPool sets CustomEmailSender with KMSKeyID
    provisionTenantLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["kms:CreateGrant", "kms:DescribeKey"],
        resources: ["*"], // KMS key ARN is dynamic (from SSM)
      }),
    );

    // 5. CloudFront - Must remain broad (distribution IDs are dynamic)
    provisionTenantLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "cloudfront:CreateInvalidation",
          "cloudfront:GetDistribution",
        ],
        resources: ["*"], // CloudFront doesn't support fine-grained resource restrictions
      }),
    );

    // enable admin api endpoints - multi-tenant support via DynamoDB
    apigateway.createAdminApiEndpoints(
      props.hostedUIDomain ? props.hostedUIDomain : "",
      userPool.adminUserpool.userPoolId,
    );

    apigateway.attachMetadataS3(webapp.s3bucket);

    // Create end user portal API endpoints with multi-tenant support
    apigateway.createEndUserPortalApiEndpoints();

    // Update post deployment lambda to handle multiple tenants
    createPostDeploymentLambda(
      this,
      userPool.adminUserpool.userPoolId,
      userPool.adminClient.userPoolClientId,
      "", // Will be handled differently for multi-tenant
    );

    // Output admin portal information
    new CfnOutput(this, "AdminPortal UserPoolId", {
      value: userPool.adminUserpool.userPoolId,
    });

    new CfnOutput(this, "AdminPortal AppClientId", {
      value: userPool.adminClient.userPoolClientId,
    });

    const str =
      hostedUI_domain_prefix?.replace(/\./g, "").toLowerCase() +
      this.region +
      this.account;
    let hash = 0;
    if (str) {
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
      }
    }

    new CfnOutput(this, "Admin Login Hosted UI URL", {
      value: `https://${hostedUI_domain_prefix}-${(hash >>> 0).toString(36)}.auth.${props.env?.region}.amazoncognito.com`,
    });

    new CfnOutput(this, "Admin Portal KickOff URL", {
      value: `https://${props.domainName}`,
    });

    // Generate amfaext.js and deploy alongside dist/ in a SINGLE BucketDeployment
    // This avoids pruning conflicts that occurred with separate deployments
    const hostedUiStr =
      hostedUI_domain_prefix?.replace(/\./g, "").toLowerCase() +
      (props.env?.region || "") +
      (props.env?.account || "");
    let hostedUiHash = 0;
    if (hostedUiStr) {
      for (let i = 0; i < hostedUiStr.length; i++) {
        hostedUiHash =
          ((hostedUiHash << 5) - hostedUiHash + hostedUiStr.charCodeAt(i)) | 0;
      }
    }
    const hostedUiUrl = `https://${hostedUI_domain_prefix}-${(hostedUiHash >>> 0).toString(36)}.auth.${props.env?.region}.amazoncognito.com`;

    const amfaExtContent = [
      `export const AdminPortalUserPoolId="${userPool.adminUserpool.userPoolId}"`,
      `export const AdminPortalClientId="${userPool.adminClient.userPoolClientId}"`,
      `export const AdminHostedUIURL="${hostedUiUrl}"`,
      `export const ProjectRegion='${props.env?.region}'`,
      `export const AdminPortalDomainName='${props.domainName}'`,
    ].join("\n");

    // Deploy dist/ + amfaext.js together in one BucketDeployment
    webapp.deployAssets([Source.data("amfaext.js", amfaExtContent)]);

    // Note: Tenant information is now dynamically queried from DynamoDB
    // No need for static CloudFormation outputs
  }
}
