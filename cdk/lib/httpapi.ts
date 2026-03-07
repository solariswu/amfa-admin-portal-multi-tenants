import * as path from "path";

import { Construct } from "constructs";
import { AppStackProps } from "./application";

import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Bucket, BucketAccessControl } from "aws-cdk-lib/aws-s3";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  DomainName,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  HttpUserPoolAuthorizer,
  HttpLambdaAuthorizer,
} from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Function, Code, Runtime, LayerVersion } from "aws-cdk-lib/aws-lambda";

import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayv2DomainProperties } from "aws-cdk-lib/aws-route53-targets";

import { SSOUserPool } from "./userpool";
import {
  AMFACONFIG_TABLE,
  AMFATENANT_TABLE,
  current_stage,
  project_name,
  service_name,
  stage_config,
  samlproxy_api_url,
  samlproxy_metadata_url,
  samlproxy_reload_url,
  samlproxy_clean_url,
} from "../config";

export class SSOApiGateway {
  scope: Construct;
  region: string | undefined;
  account: string | undefined;
  api!: HttpApi;
  certificateArn: string;
  domainName: string;
  hostedUIDomain: string;
  hostedZoneId: string;
  authorizor!: HttpUserPoolAuthorizer;
  multiTenantAuthorizor!: HttpLambdaAuthorizer;
  totpTokenAuthorizor!: HttpUserPoolAuthorizer;
  amfaBaseUrl: string;
  adminUserPoolId: string = "";
  // spinfoTable: Table;
  // importUsersJobTable: Table;
  importUsersWorkerLambda!: Function;
  imoprtUsersJobsS3Bucket!: Bucket;

  constructor(scope: Construct, props: AppStackProps) {
    this.scope = scope;
    this.region = props.env?.region;
    this.account = props.env?.account;
    this.certificateArn = props.apiCertificate.certificateArn;
    this.domainName = props.domainName ? props.domainName : "";
    this.hostedZoneId = props.hostedZoneId ? props.hostedZoneId : "";
    this.hostedUIDomain = props.hostedUIDomain ? props.hostedUIDomain : "";
    this.amfaBaseUrl = props.amfaBaseUrl;

    // this.spinfoTable = this.createSPInfoTable();
    // this.importUsersJobTable = this.createImportUsersJobTable();

    this.createHttpApi();
  }

  private createImportUsersWorkerLambda = () => {
    const workerlambda = new Function(this.scope, "importusersworkerlambda", {
      functionName: `${project_name}-importusersworker-${this.region}`,
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(
        path.join(__dirname, `/../lambda/importusersworker/dist`),
      ),
      environment: {
        IMPORTUSERS_BUCKET: this.imoprtUsersJobsS3Bucket.bucketName,
        IMPORTUSERS_WORKER_LAMBDA: `${project_name}-importusersworker-${this.region}`,
      },
      timeout: Duration.minutes(15),
      memorySize: 256,
      retryAttempts: 0,
    });

    workerlambda.role?.attachInlinePolicy(
      new Policy(this.scope, `importusers-worker-policy`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
          }),
          new PolicyStatement({
            resources: [
              `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`,
            ],
            actions: [
              "cognito-idp:AdminCreateUser",
              "cognito-idp:AdminAddUserToGroup",
              "cognito-idp:AdminLinkProviderForUser",
            ],
          }),
          new PolicyStatement({
            resources: [
              `arn:aws:secretsmanager:${this.region}:${this.account}:secret:apersona/*`,
            ],
            actions: ["secretsmanager:GetSecretValue"],
          }),
          new PolicyStatement({
            resources: [
              this.imoprtUsersJobsS3Bucket.bucketArn,
              `${this.imoprtUsersJobsS3Bucket.bucketArn}/*`,
            ],
            actions: [
              "s3:GetObject",
              "s3:PutObject",
              "s3:DeleteObject",
              "s3:ListBucket",
            ],
          }),
          new PolicyStatement({
            resources: [
              `arn:aws:lambda:${this.region}:${this.account}:function:${project_name}-importusersworker-${this.region}`,
            ],
            actions: ["lambda:InvokeFunction"],
          }),
        ],
      }),
    );

    return workerlambda;
  };

  public attachAuthorizor(userPool: SSOUserPool) {
    this.authorizor = new HttpUserPoolAuthorizer(
      "httpapi_authorizor",
      userPool.adminUserpool,
      { userPoolClients: [userPool.adminClient] },
    );

    this.totpTokenAuthorizor = new HttpUserPoolAuthorizer(
      "httpapi_authorizor2",
      userPool.adminUserpool,
      { userPoolClients: [userPool.clientCredentialsClient] },
    );
  }

  public attachMetadataS3(s3bucket: Bucket) {
    const metadataListFunction = new Function(
      this.scope,
      "spmetadataslist_function",
      {
        code: Code.fromAsset(path.join(__dirname, "../lambda/spmetadataslist")),
        runtime: Runtime.NODEJS_LATEST,
        handler: "index.handler",
        timeout: Duration.minutes(3),
        environment: {
          S3_BASE_URL: `${stage_config[current_stage].domainName}`,
          BUCKET: s3bucket.bucketName,
          SERVICE_NAME: service_name,
        },
      },
    );

    s3bucket.grantReadWrite(metadataListFunction);

    const metadataListIntegration = new HttpLambdaIntegration(
      "spmetadataslist_integration",
      metadataListFunction,
    );

    this.api.addRoutes({
      path: "/metadataslist",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: metadataListIntegration,
    });

    const metadataFunction = new Function(this.scope, "spmetadatas_function", {
      code: Code.fromAsset(path.join(__dirname, "../lambda/spmetadatas")),
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      timeout: Duration.minutes(3),
      environment: {
        S3_BASE_URL: `${stage_config[current_stage].domainName}`,
        BUCKET: s3bucket.bucketName,
        SERVICE_NAME: service_name,
      },
    });

    s3bucket.grantReadWrite(metadataListFunction);

    const metadataIntegration = new HttpLambdaIntegration(
      "spmetadatas_integration",
      metadataFunction,
    );

    this.api.addRoutes({
      path: "/metadatas",
      methods: [HttpMethod.GET, HttpMethod.DELETE],
      integration: metadataIntegration,
    });
  }

  private userPoolIdToArn(userPoolId: string): string {
    return `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`;
  }

  private tableNameToArn(tableName: string): string {
    return `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}`;
  }

  // private createSPInfoTable() {
  //     const table = new Table(this.scope, `${service_name}-${project_name}-spinfo`, {
  //         partitionKey: { name: 'id', type: AttributeType.STRING },
  //         billingMode: BillingMode.PAY_PER_REQUEST,
  //         removalPolicy: RemovalPolicy.DESTROY,
  //     });
  //     return table;
  // }

  // private createImportUsersJobTable() {
  // 	const table = new Table(this.scope, `${service_name}-${project_name}-importjobid`, {
  //         tableName: `${service_name}-${project_name}-importjobid`,
  //         partitionKey: { name: 'jobid', type: AttributeType.STRING },
  // 		billingMode: BillingMode.PAY_PER_REQUEST,
  // 		removalPolicy: RemovalPolicy.DESTROY,
  // 		timeToLiveAttribute: 'ttl',
  // 	});
  //     table.addGlobalSecondaryIndex({
  //         indexName: 'jobid-index',
  //         partitionKey: { name: 'userpoolid', type: AttributeType.STRING },
  //         sortKey: { name: 'createat', type: AttributeType.STRING }
  //     })
  // 	return table;
  // }

  private createHttpApi() {
    const domain = new DomainName(this.scope, "httpapi_domain", {
      domainName: `api.${this.domainName}`,
      certificate: Certificate.fromCertificateArn(
        this.scope,
        "cert",
        this.certificateArn,
      ),
    });

    this.api = new HttpApi(this.scope, "http-api", {
      description: "HTTP API",
      corsPreflight: {
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "X-Tenant-Id",
        ],
        allowMethods: [
          CorsHttpMethod.OPTIONS,
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
        ],
        allowCredentials: false,
        allowOrigins: ["*"],
      },
      defaultDomainMapping: {
        domainName: domain,
      },
      disableExecuteApiEndpoint: true,
    });

    new ARecord(this.scope, "apiAliasRecord", {
      zone: HostedZone.fromHostedZoneAttributes(
        this.scope,
        "hostedZoneWithAttributes",
        {
          hostedZoneId: this.hostedZoneId,
          zoneName: this.domainName,
        },
      ),
      recordName: "api",
      target: RecordTarget.fromAlias(
        new ApiGatewayv2DomainProperties(
          domain.regionalDomainName,
          domain.regionalHostedZoneId,
        ),
      ),
    });
  }

  public createAdminApiEndpoints(
    userPoolDomain: string,
    adminUserPoolId: string,
  ) {
    this.adminUserPoolId = adminUserPoolId;
    const resourceTypes = [
      "users",
      "groups",
      "idps",
      "appclients",
      "admins",
      "admingroups",
    ];

    this.imoprtUsersJobsS3Bucket = new Bucket(
      this.scope,
      `${project_name}-${this.region}-ImportUsersBucket`,
      {
        bucketName: `${this.account}-${this.region}-${project_name}-importusersjobs`,
        accessControl: BucketAccessControl.PRIVATE,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );

    this.importUsersWorkerLambda = this.createImportUsersWorkerLambda();

    // Create auth layer once and reuse it for all Lambda functions that need it
    const authLayer = new LayerVersion(this.scope, "AdminAuthLayer", {
      code: Code.fromAsset(
        path.join(__dirname, "/../lambda-layers/auth-layer"),
      ),
      compatibleRuntimes: [
        Runtime.NODEJS_18_X,
        Runtime.NODEJS_20_X,
        Runtime.NODEJS_22_X,
      ],
      description:
        "Shared authorization utilities for admin portal multi-tenant support",
    });

    resourceTypes.forEach((resourceType) => {
      const poolId =
        resourceType === "admins" || resourceType === "admingroups"
          ? adminUserPoolId
          : "";
      const lambdaList = this.createLambda(
        `${resourceType}list`,
        poolId,
        this.getPolicyStatements(),
        authLayer,
      );
      // 👇 add route for GET /resource
      this.api.addRoutes({
        path: `/${resourceType}`,
        methods: [
          HttpMethod.DELETE,
          HttpMethod.GET,
          HttpMethod.POST,
          HttpMethod.PUT,
        ],
        integration: new HttpLambdaIntegration(
          `list-${resourceType}-integration`,
          lambdaList,
        ),
        authorizer: this.authorizor,
      });

      if (resourceType !== "admingroups") {
        const lambda = this.createLambda(
          `${resourceType}`,
          poolId,
          this.getPolicyStatements(),
          authLayer,
        );
        // 👇 add route for CRUD /resource/id
        this.api.addRoutes({
          path: `/${resourceType}/{id}`,
          methods: [
            HttpMethod.DELETE,
            HttpMethod.GET,
            HttpMethod.POST,
            HttpMethod.PUT,
          ],
          integration: new HttpLambdaIntegration(
            `${resourceType}-integration`,
            lambda,
          ),
          authorizer: this.authorizor,
        });
      }
    });

    const samlsListLambda = this.createAmfaSamlSpsLambda("samlslist");
    // 👇 add route for GET /resource
    this.api.addRoutes({
      path: "/samls",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        `list-samls-integration`,
        samlsListLambda,
      ),
      authorizer: this.authorizor,
    });
    const samlsLambda = this.createAmfaSamlSpsLambda("samls");
    // 👇 add route for CRUD /resource/id
    this.api.addRoutes({
      path: "/samls/{id}",
      methods: [HttpMethod.DELETE, HttpMethod.GET, HttpMethod.PUT],
      integration: new HttpLambdaIntegration("samls-integration", samlsLambda),
      authorizer: this.authorizor,
    });

    // tenants apis
    const lambdaList = this.createAmfaTenantsLambda(
      AMFATENANT_TABLE,
      "tenantslist",
      authLayer,
    );
    // 👇 add route for GET /resource
    this.api.addRoutes({
      path: "/tenants",
      methods: [
        HttpMethod.DELETE,
        HttpMethod.GET,
        HttpMethod.POST,
        HttpMethod.PUT,
      ],
      integration: new HttpLambdaIntegration(
        `list-tenants-integration`,
        lambdaList,
      ),
      authorizer: this.authorizor,
    });
    const lambda = this.createAmfaTenantsLambda(
      AMFATENANT_TABLE,
      "tenants",
      authLayer,
    );
    // 👇 add route for CRUD /resource/id
    this.api.addRoutes({
      path: "/tenants/{id}",
      methods: [
        HttpMethod.DELETE,
        HttpMethod.GET,
        HttpMethod.POST,
        HttpMethod.PUT,
      ],
      integration: new HttpLambdaIntegration("tenants-integration", lambda),
      authorizer: this.authorizor,
    });

    // amfa fetch configs api
    const fetchAmfaConfigLambda = this.createFetchAmfaConfigLambda(authLayer);

    this.api.addRoutes({
      path: "/amfaconfig",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "fetch-amfaconfig-integration",
        fetchAmfaConfigLambda,
      ),
      authorizer: this.authorizor,
    });

    // amfa smtp config api
    const smtplambda = this.createSmtpConfigLambda(authLayer);

    this.api.addRoutes({
      path: "/smtpconfig",
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "smtpconfig-integration",
        smtplambda,
      ),
      authorizer: this.authorizor,
    });

    const brandingsLambda = this.createBrandingLambda("brandings", authLayer);

    this.api.addRoutes({
      path: "/brandings/{id}",
      methods: [HttpMethod.GET, HttpMethod.PUT],
      integration: new HttpLambdaIntegration(
        `brandings-integration`,
        brandingsLambda,
      ),
      authorizer: this.authorizor,
    });

    const brandingslistLambda = this.createBrandingLambda(
      "brandingslist",
      authLayer,
    );

    this.api.addRoutes({
      path: "/brandings",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        `brandingslist-integration`,
        brandingslistLambda,
      ),
      authorizer: this.authorizor,
    });

    // organizations apis - dedicated Lambda with ASM portal integration
    const organizationsListLambda =
      this.createOrganizationsLambda(adminUserPoolId);

    this.api.addRoutes({
      path: "/organizations",
      methods: [
        HttpMethod.DELETE,
        HttpMethod.GET,
        HttpMethod.POST,
        HttpMethod.PUT,
      ],
      integration: new HttpLambdaIntegration(
        `list-organizations-integration`,
        organizationsListLambda,
      ),
      authorizer: this.authorizor,
    });

    // Reuse the same Lambda for detail route
    this.api.addRoutes({
      path: "/organizations/{id}",
      methods: [
        HttpMethod.DELETE,
        HttpMethod.GET,
        HttpMethod.POST,
        HttpMethod.PUT,
      ],
      integration: new HttpLambdaIntegration(
        "organizations-integration",
        organizationsListLambda, // Reuse the same Lambda
      ),
      authorizer: this.authorizor,
    });

    const totptokenLambda = this.createTotpTokenLambda(adminUserPoolId);

    this.api.addRoutes({
      path: "/totptoken",
      methods: [HttpMethod.GET, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration(
        "totptoken-integration",
        totptokenLambda,
      ),
      authorizer: this.totpTokenAuthorizor,
    });
  }

  private createTotpTokenLambda(adminUserpoolId: string) {
    const totpTokenLambda = new Function(this.scope, "TotpToken", {
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(path.join(__dirname, "/../lambda/totptoken")),
      environment: {
        ADMIN_USERPOOL_ID: adminUserpoolId,
      },
      timeout: Duration.seconds(30),
    });

    totpTokenLambda.role?.attachInlinePolicy(
      new Policy(this.scope, `amfa-totptoken-lambda-policy`, {
        statements: [
          new PolicyStatement({
            actions: [
              "dynamodb:GetItem",
              "dynamodb:PutItem",
              "dynamodb:DeleteItem",
              "dynamodb:Scan",
            ],
            resources: [`arn:aws:dynamodb:${this.region}:*:table/*`],
          }),
        ],
      }),
    );

    return totpTokenLambda;
  }

  public createMultiTenantAuthorizer() {
    // Create multi-tenant custom authorizer lambda
    const multiTenantAuthorizerLambda = new Function(
      this.scope,
      "MultiTenantAuthorizer",
      {
        runtime: Runtime.NODEJS_LATEST,
        handler: "index.handler",
        code: Code.fromAsset(
          path.join(__dirname, "/../lambda/multi-tenant-authorizer"),
        ),
        timeout: Duration.seconds(30),
      },
    );

    // Grant permissions to describe user pools and read from DynamoDB
    multiTenantAuthorizerLambda.role?.attachInlinePolicy(
      new Policy(this.scope, "MultiTenantAuthorizerPolicy", {
        statements: [
          new PolicyStatement({
            actions: ["cognito-idp:DescribeUserPool"],
            resources: [`arn:aws:cognito-idp:${this.region}:*:userpool/*`],
          }),
        ],
      }),
    );

    // Create the Lambda authorizer
    this.multiTenantAuthorizor = new HttpLambdaAuthorizer(
      "MultiTenantHttpAuthorizer",
      multiTenantAuthorizerLambda,
    );
  }

  public createEndUserPortalApiEndpoints() {
    // Create multi-tenant authorizer if tenant reader is provided
    this.createMultiTenantAuthorizer();
    const serviceProvidersListLambda = this.createServicePrvoiderLambda(
      "serviceproviderslist",
    );
    // 👇 add route for GET /resource
    this.api.addRoutes({
      path: "/serviceproviders",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        `list-usrportal-splist-integration`,
        serviceProvidersListLambda,
      ),
      authorizer: this.multiTenantAuthorizor,
    });

    const customServiceProvidersListLambda =
      this.createUserCustomSPSLambda("usercustomsps");
    // 👇 add route for GET /resource
    this.api.addRoutes({
      path: "/usercustomsps/{id}",
      methods: [HttpMethod.GET, HttpMethod.PUT],
      integration: new HttpLambdaIntegration(
        `list-usrportal-usercustomsps-integration`,
        customServiceProvidersListLambda,
      ),
      authorizer: this.multiTenantAuthorizor,
    });
  }

  private createServicePrvoiderLambda(lambdaName: string) {
    const lambda = new Function(this.scope, lambdaName, {
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(
        path.join(__dirname, `/../lambda/${lambdaName}/dist`),
      ),
      environment: {
        AMFA_SPINFO_TABLE: "amfa-spinfo",
        SAMLPROXY_API_URL: samlproxy_api_url,
        SAMLPROXY_RELOAD_URL: samlproxy_reload_url,
        SAMLPROXY_CLEAN_URL: samlproxy_clean_url,
      },
      timeout: Duration.minutes(5),
    });

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy`, {
        statements: [
          new PolicyStatement({
            resources: [`arn:aws:dynamodb:${this.region}:*:table/*`],
            actions: ["dynamodb:GetItem", "dynamodb:Scan"],
          }),
          new PolicyStatement({
            resources: ["*"],
            actions: ["cognito-idp:ListUserPoolClients"],
          }),
        ],
      }),
    );

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-passrole-policy`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["iam:PassRole"],
          }),
        ],
      }),
    );

    return lambda;
  }

  private createUserCustomSPSLambda(lambdaName: string) {
    const lambda = new Function(this.scope, lambdaName, {
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(path.join(__dirname, `/../lambda/${lambdaName}`)),
      // environment: {
      //     USERPOOL_ID: userPoolId,
      // },
      timeout: Duration.minutes(5),
    });

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: [
              "cognito-idp:AdminUpdateUserAttributes",
              "cognito-idp:AdminGetUser",
            ],
          }),
        ],
      }),
    );

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-passrole-policy`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["iam:PassRole"],
          }),
        ],
      }),
    );

    return lambda;
  }

  private createAmfaSamlSpsLambda(lambdaName: string) {
    const lambda = new Function(this.scope, lambdaName, {
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(
        path.join(__dirname, `/../lambda/${lambdaName}/dist`),
      ),
      environment: {
        AMFA_BASE_URL: this.amfaBaseUrl,
        AMFA_SPINFO_TABLE: "amfa-spinfo",
        SAMLPROXY_API_URL: samlproxy_api_url,
        SAMLPROXY_RELOAD_URL: samlproxy_reload_url,
        SAMLPROXY_CLEAN_URL: samlproxy_clean_url,
      },
      timeout: Duration.minutes(5),
    });

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: [
              "dynamodb:GetItem",
              "dynamodb:PutItem",
              "dynamodb:Scan",
              "dynamodb:DeleteItem",
            ],
          }),
        ],
      }),
    );

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-passrole-policy`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["iam:PassRole"],
          }),
        ],
      }),
    );

    return lambda;
  }

  private createAmfaTenantsLambda(
    tableName: string,
    lambdaName: string,
    authLayer?: LayerVersion,
  ) {
    const lambda = new Function(this.scope, lambdaName, {
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(path.join(__dirname, `/../lambda/${lambdaName}`)),
      ...(authLayer && { layers: [authLayer] }),
      environment: {
        AMFA_BASE_URL: this.amfaBaseUrl,
        AMFATENANT_TABLE,
        SAMLPROXY_API_URL: samlproxy_api_url,
        SAMLPROXY_RELOAD_URL: samlproxy_reload_url,
        SAMLPROXY_CLEAN_URL: samlproxy_clean_url,
        SAMLPROXY_METADATA_URL: samlproxy_metadata_url,
        ROOT_DOMAIN_NAME: this.domainName ? this.domainName : "",
        ACCOUNT_ID: this.account || "",
        PROVISION_TENANT_FUNCTION_NAME: `${project_name}-provision-tenant-${this.region}`,
        ADMIN_USERPOOL_ID: this.adminUserPoolId,
        ASM_PORTAL_URL: process.env.ASM_PORTAL_URL || "",
      },
      timeout: Duration.minutes(5),
    });

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy`, {
        statements: [
          new PolicyStatement({
            resources: [this.tableNameToArn(tableName)],
            actions: [
              "dynamodb:GetItem",
              "dynamodb:PutItem",
              "dynamodb:Query",
              "dynamodb:Scan",
              "dynamodb:DeleteItem",
            ],
          }),
          new PolicyStatement({
            resources: [
              `arn:aws:secretsmanager:${this.region}:${this.account}:secret:apersona/*`,
            ],
            actions: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:UpdateSecret",
            ],
          }),
        ],
      }),
    );

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-passrole-policy`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["iam:PassRole"],
          }),
        ],
      }),
    );

    // Add permissions for tenantslist to invoke provision-tenant and manage Cognito users
    if (lambdaName === "tenantslist") {
      lambda.role?.attachInlinePolicy(
        new Policy(this.scope, `${lambdaName}-provision-policy`, {
          statements: [
            new PolicyStatement({
              resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:${project_name}-provision-tenant-${this.region}`,
              ],
              actions: ["lambda:InvokeFunction"],
            }),
            new PolicyStatement({
              resources: [
                `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`,
              ],
              actions: [
                "cognito-idp:AdminCreateUser",
                "cognito-idp:CreateGroup",
                "cognito-idp:DeleteGroup",
                "cognito-idp:AdminAddUserToGroup",
              ],
            }),
          ],
        }),
      );
    }

    // Add permissions for tenants Lambda (hard delete support)
    if (lambdaName === "tenants") {
      // Cognito: DeleteGroup + DescribeUserPool + DeleteUserPoolDomain
      lambda.role?.attachInlinePolicy(
        new Policy(this.scope, `${lambdaName}-cognito-policy`, {
          statements: [
            new PolicyStatement({
              resources: [
                `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`,
              ],
              actions: [
                "cognito-idp:DeleteGroup",
                "cognito-idp:DescribeUserPool",
                "cognito-idp:DeleteUserPoolDomain",
              ],
            }),
          ],
        }),
      );

      // DynamoDB: DeleteTable + DescribeTable for per-tenant tables
      lambda.role?.attachInlinePolicy(
        new Policy(this.scope, `${lambdaName}-ddb-cleanup-policy`, {
          statements: [
            new PolicyStatement({
              resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/amfa-*`,
              ],
              actions: [
                "dynamodb:DeleteTable",
                "dynamodb:DescribeTable",
                "dynamodb:DeleteItem",
              ],
            }),
          ],
        }),
      );

      // S3: DeleteObject for config files in both SP Portal and AMFA Service buckets
      lambda.role?.attachInlinePolicy(
        new Policy(this.scope, `${lambdaName}-s3-cleanup-policy`, {
          statements: [
            new PolicyStatement({
              resources: [
                "arn:aws:s3:::sp-portal-shared-*/*",
                "arn:aws:s3:::amfa-service-shared-*/*",
              ],
              actions: ["s3:DeleteObject"],
            }),
          ],
        }),
      );

      // Secrets Manager: DeleteSecret for per-tenant secrets
      lambda.role?.attachInlinePolicy(
        new Policy(this.scope, `${lambdaName}-secrets-cleanup-policy`, {
          statements: [
            new PolicyStatement({
              resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:apersona/*`,
              ],
              actions: ["secretsmanager:DeleteSecret"],
            }),
          ],
        }),
      );
    }

    return lambda;
  }

  private createFetchAmfaConfigLambda(authLayer: LayerVersion) {
    const lambdaName = "amfaconfig";

    const lambda = new Function(this.scope, lambdaName, {
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(path.join(__dirname, `/../lambda/${lambdaName}`)),
      layers: [authLayer],
      environment: {
        AMFACONFIG_TABLE,
        AMFATENANT_TABLE,
        // USERPOOL_ID removed - Lambda gets it from tenant table via auth layer
      },
      timeout: Duration.minutes(5),
    });

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy-dynamo`, {
        statements: [
          new PolicyStatement({
            resources: [
              this.tableNameToArn(AMFACONFIG_TABLE),
              this.tableNameToArn(AMFATENANT_TABLE),
              `${this.tableNameToArn(AMFATENANT_TABLE)}/index/*`, // Grant access to GSI
            ],
            actions: [
              "dynamodb:GetItem",
              "dynamodb:Query", // For GSI queries
            ],
          }),
        ],
      }),
    );

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy-cognito`, {
        statements: [
          new PolicyStatement({
            resources: [
              `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`,
            ],
            actions: ["cognito-idp:DescribeUserPool"],
          }),
        ],
      }),
    );

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-passrole-policy`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["iam:PassRole"],
          }),
        ],
      }),
    );

    return lambda;
  }

  private createOrganizationsLambda(adminUserPoolId: string) {
    const lambdaName = "organizationslist";

    const lambda = new Function(this.scope, lambdaName, {
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(path.join(__dirname, `/../lambda/${lambdaName}`)),
      environment: {
        ASM_PORTAL_URL: process.env.ASM_PORTAL_URL || "",
        ACCOUNT_ID: this.account || "",
        ADMIN_USERPOOL_ID: adminUserPoolId,
      },
      timeout: Duration.minutes(5),
    });

    // DynamoDB permissions for amfa-tenanttable (org CRUD)
    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy`, {
        statements: [
          new PolicyStatement({
            resources: [
              `arn:aws:dynamodb:${this.region}:${this.account}:table/amfa-tenanttable`,
              `arn:aws:dynamodb:${this.region}:${this.account}:table/amfa-tenanttable/index/*`,
            ],
            actions: [
              "dynamodb:GetItem",
              "dynamodb:PutItem",
              "dynamodb:UpdateItem",
              "dynamodb:DeleteItem",
              "dynamodb:Query",
              "dynamodb:Scan",
            ],
          }),
        ],
      }),
    );

    // Secrets Manager permissions for ASM org credentials and install key
    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-secrets-policy`, {
        statements: [
          new PolicyStatement({
            resources: [
              `arn:aws:secretsmanager:${this.region}:${this.account}:secret:apersona/asm/org/*`,
              `arn:aws:secretsmanager:${this.region}:${this.account}:secret:apersona/asm/installkey*`,
            ],
            actions: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:CreateSecret",
              "secretsmanager:PutSecretValue",
              "secretsmanager:TagResource",
            ],
          }),
        ],
      }),
    );

    // Cognito permissions for creating SPA_ group in admin userpool
    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-cognito-policy`, {
        statements: [
          new PolicyStatement({
            resources: [
              `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${adminUserPoolId}`,
            ],
            actions: ["cognito-idp:CreateGroup", "cognito-idp:DeleteGroup"],
          }),
        ],
      }),
    );

    return lambda;
  }

  private getPolicyStatements() {
    const statements: PolicyStatement[] = [];
    statements.push(
      new PolicyStatement({
        resources: ["*"],
        actions: [
          "cognito-idp:*",
          "dynamodb:*",
          "s3:*",
          "lambda:InvokeFunction",
          "iam:PassRole",
        ],
      }),
    );
    return statements;
  }

  private createLambda(
    lambdaName: string,
    userPoolId: string,
    statements: PolicyStatement[],
    authLayer?: LayerVersion,
  ) {
    if (lambdaName === "importuserslist") {
      const lambda = new Function(this.scope, lambdaName, {
        runtime: Runtime.NODEJS_LATEST,
        handler: "index.handler",
        code: Code.fromAsset(path.join(__dirname, `/../lambda/${lambdaName}`)),
        ...(authLayer && { layers: [authLayer] }),
        environment: {
          AMFA_BASE_URL: this.amfaBaseUrl,
          AMFA_SPINFO_TABLE: "amfa-spinfo",
          AMFATENANT_TABLE,
          IMPORTUSERS_JOB_ID_TABLE: "amfa-importjobid",
          IMPORTUSERS_WORKER_LAMBDA: this.importUsersWorkerLambda.functionName,
          IMPORTUSERS_BUCKET: this.imoprtUsersJobsS3Bucket.bucketName,
        },
        timeout: Duration.minutes(5),
      });

      lambda.role?.attachInlinePolicy(
        new Policy(this.scope, `${lambdaName}-policy`, { statements }),
      );
      return lambda;
    } else if (lambdaName === "adminslist") {
      // adminslist needs ASM_PORTAL_URL and Secrets Manager access
      // for registering SPA admins with ASM portal
      const lambda = new Function(this.scope, lambdaName, {
        runtime: Runtime.NODEJS_LATEST,
        handler: "index.handler",
        code: Code.fromAsset(path.join(__dirname, `/../lambda/${lambdaName}`)),
        ...(authLayer && { layers: [authLayer] }),
        environment: {
          USERPOOL_ID: userPoolId,
          AMFA_BASE_URL: this.amfaBaseUrl,
          AMFA_SPINFO_TABLE: "amfa-spinfo",
          IMPORTUSERS_JOB_ID_TABLE: "amfa-importjobid",
          IMPORTUSERS_BUCKET: this.imoprtUsersJobsS3Bucket.bucketName,
          ACCOUNT_ID: this.account || "",
          ASM_PORTAL_URL: process.env.ASM_PORTAL_URL || "",
        },
        timeout: Duration.minutes(5),
      });

      lambda.role?.attachInlinePolicy(
        new Policy(this.scope, `${lambdaName}-policy`, { statements }),
      );

      // Secrets Manager read access for org and tenant ASM credentials
      lambda.role?.attachInlinePolicy(
        new Policy(this.scope, `${lambdaName}-secrets-policy`, {
          statements: [
            new PolicyStatement({
              resources: [
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:apersona/asm/org/*`,
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:apersona/asm/tenant/*`,
              ],
              actions: ["secretsmanager:GetSecretValue"],
            }),
          ],
        }),
      );

      return lambda;
    } else {
      const lambda = new Function(this.scope, lambdaName, {
        runtime: Runtime.NODEJS_LATEST,
        handler: "index.handler",
        code: Code.fromAsset(path.join(__dirname, `/../lambda/${lambdaName}`)),
        ...(authLayer && { layers: [authLayer] }),
        environment: {
          USERPOOL_ID: userPoolId,
          AMFA_BASE_URL: this.amfaBaseUrl,
          AMFA_SPINFO_TABLE: "amfa-spinfo",
          IMPORTUSERS_JOB_ID_TABLE: "amfa-importjobid",
          IMPORTUSERS_BUCKET: this.imoprtUsersJobsS3Bucket.bucketName,
          ACCOUNT_ID: this.account || "",
        },
        timeout: Duration.minutes(5),
      });

      lambda.role?.attachInlinePolicy(
        new Policy(this.scope, `${lambdaName}-policy`, { statements }),
      );

      return lambda;
    }
  }

  private createSmtpConfigLambda(authLayer: LayerVersion) {
    const lambdaName = "smtpconfig";

    const lambda = new Function(this.scope, lambdaName, {
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(path.join(__dirname, `/../lambda/${lambdaName}`)),
      layers: [authLayer],
      environment: {
        AMFATENANT_TABLE,
        // TENANT_ID removed - Lambda gets tenant_id from request
      },
      timeout: Duration.minutes(5),
    });

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy-secrets`, {
        statements: [
          new PolicyStatement({
            resources: [
              `arn:aws:secretsmanager:${this.region}:${this.account}:secret:apersona/*`,
            ],
            actions: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:UpdateSecret",
            ],
          }),
        ],
      }),
    );

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy-dynamo`, {
        statements: [
          new PolicyStatement({
            resources: [
              this.tableNameToArn(AMFATENANT_TABLE),
              `${this.tableNameToArn(AMFATENANT_TABLE)}/index/*`,
            ],
            actions: ["dynamodb:GetItem", "dynamodb:Query"],
          }),
        ],
      }),
    );

    return lambda;
  }

  private createBrandingLambda(lambdaName: string, authLayer: LayerVersion) {
    // Multi-tenant branding Lambda - tenant_id comes from request
    const lambda = new Function(this.scope, lambdaName, {
      runtime: Runtime.NODEJS_LATEST,
      handler: "index.handler",
      code: Code.fromAsset(path.join(__dirname, `/../lambda/${lambdaName}`)),
      layers: [authLayer],
      environment: {
        AMFATENANT_TABLE,
        SPPORTAL_BUCKET_PREFIX: `${this.account || ""}-${service_name}`,
        ADMINPORTAL_BUCKETNAME: `${this.account || ""}-${this.region || ""}-adminportal-${service_name}-web`,
        ADMINPORTAL_DISTRIBUTION_ID:
          process.env.ADMINPORTAL_DISTRIBUTION_ID || "",
      },
      timeout: Duration.minutes(5),
    });

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy-s3`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
          }),
        ],
      }),
    );

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy-cloudfront`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["cloudfront:CreateInvalidation"],
          }),
        ],
      }),
    );

    lambda.role?.attachInlinePolicy(
      new Policy(this.scope, `${lambdaName}-policy-dynamo`, {
        statements: [
          new PolicyStatement({
            resources: ["*"],
            actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
          }),
        ],
      }),
    );

    return lambda;
  }
}
