import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";

import {
  CfnOutput,
  Stack,
  StackProps,
  Duration,
  CustomResource,
} from "aws-cdk-lib";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

import { WebApplication } from "./webapp";
import { SPPortalWebApp } from "./sp-portal-webapp";

import { SSOApiGateway } from "./httpapi";
import { SSOUserPool } from "./userpool";
import { hostedUI_domain_prefix } from "../config";
import { createPostDeploymentLambda } from "./postDeployment";

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

    // Note: Tenant information is now dynamically queried from DynamoDB
    // No need for static CloudFormation outputs
  }

}
