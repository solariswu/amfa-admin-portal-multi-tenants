import { Construct } from "constructs";
import {
  UserPool,
  UserPoolClient,
  OAuthScope,
  AccountRecovery,
  Mfa,
  UserPoolClientIdentityProvider,
  UserPoolResourceServer,
  ResourceServerScope,
} from "aws-cdk-lib/aws-cognito";

import { Duration } from "aws-cdk-lib";

import { AppStackProps } from "./application";
import { hostedUI_domain_prefix, stage_config, current_stage, service_name, totpScopeName } from "../config";

export interface TenantUserPoolInfo {
  tenantId: string;
  userPoolId: string;
  samlClient: UserPoolClient;
  enduserPortalClient: UserPoolClient;
  spPortalDomain: string;
}

export class SSOUserPool {
  scope: Construct;
  region: string | undefined;
  account: string | undefined;
  // appUserPoolIds: { [tenantId: string]: string } = {};
  tenantUserPools: TenantUserPoolInfo[] = [];
  adminUserpool: UserPool;
  adminClient: UserPoolClient;
  domainName: string;
  // for mobileToken endpoints
  clientCredentialsClient: UserPoolClient;
  totpScope!: ResourceServerScope;
  resouceServer!: UserPoolResourceServer;

  constructor(scope: Construct, props: AppStackProps) {
    this.scope = scope;
    this.account = props.env?.account;
    this.region = props.env?.region;
    this.domainName = props.domainName ? props.domainName : "";

    // Create admin userpool (single for all tenants)
    this.adminUserpool = this.createUserPool("Admin");
    this.adminClient = this.addAdminClient();
    this.clientCredentialsClient = this.addClientCredentialClient();
  }

  // // Create SAML client for a specific tenant
  // public createSamlClientForTenant(
  //   tenantId: string,
  //   userPoolId: string,
  // ): UserPoolClient {
  //   return new UserPoolClient(this.scope, `samlproxyclient-${tenantId}`, {
  //     userPool: UserPool.fromUserPoolId(
  //       this.scope,
  //       `appuserpool-${tenantId}`,
  //       userPoolId,
  //     ),
  //     generateSecret: true,
  //     authFlows: {
  //       userSrp: true,
  //     },
  //     oAuth: {
  //       flows: {
  //         authorizationCodeGrant: true,
  //       },
  //       scopes: [OAuthScope.OPENID, OAuthScope.PROFILE, OAuthScope.EMAIL],
  //       callbackUrls: ["http://localhost:3000/" /*, ...apps_urls*/],
  //       logoutUrls: ["http://localhost:3000/" /*, ...apps_urls*/],
  //     },
  //     userPoolClientName: `samlproxyClient-${tenantId}`,
  //     supportedIdentityProviders: [
  //       UserPoolClientIdentityProvider.custom("apersona"),
  //     ],
  //   });
  // }

  private createUserPool = (type: string) => {
    this.totpScope = new ResourceServerScope({ scopeName: totpScopeName, scopeDescription: totpScopeName });

    const myuserpool = new UserPool(this.scope, `SSO-${type}-userpool`, {
      userPoolName: `aPersona-AWS-Identity-SSO-${type}-UserPool`,
      // use self sign-in is disable by default
      selfSignUpEnabled: false,
      signInAliases: {
        // username sign-in
        username: false,
        // email as username
        email: true,
        phone: false,
      },
      signInCaseSensitive: false,
      // user attributes
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      // temporary password lives for 30 days
      passwordPolicy: {
        tempPasswordValidity: Duration.days(30),
        requireSymbols: true,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
      },
      // no customer attribute
      // MFA optional
      mfa: Mfa.REQUIRED,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
      // forgotPassword recovery method, phone by default
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // new admin user creation message
      userInvitation: {
        emailSubject: "aPersona Identity Admin Portal - New Account",
        emailBody: `<body><p>Hello {username},</p><p>Your new aPersona Identity admin account has been created.</p><p>Your temporary password is </p><p><strong>{####}</strong></p><p>and the URL is <a href="https://${stage_config[current_stage].domainName}" target="_blank" rel="noreffer">https://${stage_config[current_stage].domainName}</a></p><p>(It may take a few minutes to several hours for this URL to propagate and route correctly.)</p><p>Please make a note of it, and welcome to aPersona Identity on AWS!!</p><p>(When copying your password, be sure that you don't select any spaces before or after the password.)</p><p>~ Your aPersona Team</p></body>`,
        smsMessage:
          "Hello {username}, Your new aPersona Identity admin account has been created. Your temporary password is {####}",
      },
    });

    this.resouceServer = myuserpool.addResourceServer(`AMFAResourceServer-${type}`, {
      identifier: service_name,
      scopes: [this.totpScope],
    });

    return myuserpool;
  };

  private addAdminClient() {
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

    this.adminUserpool.addDomain("adminHostedUI-domain", {
      cognitoDomain: {
        domainPrefix: `${hostedUI_domain_prefix}-${(hash >>> 0).toString(36)}`,
      },
    });

    const supportedIdentityProviders = [UserPoolClientIdentityProvider.COGNITO];

    return new UserPoolClient(this.scope, "adminClient", {
      userPool: this.adminUserpool,
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          OAuthScope.EMAIL,
          OAuthScope.OPENID,
          OAuthScope.PROFILE,
          OAuthScope.COGNITO_ADMIN,
        ],
        callbackUrls: [
          `https://${this.domainName}`,
          "http://localhost:5173",
          `https://${this.domainName}/auth-callback`,
          "http://localhost:5173/auth-callback",
        ],
        logoutUrls: [`https://${this.domainName}`, "http://localhost:5173"],
      },
      userPoolClientName: "AdminPortalClient",
      supportedIdentityProviders,
    });
  }

  private addClientCredentialClient() {
    return new UserPoolClient(this.scope, "clientcredentialsClient", {
      userPool: this.adminUserpool,
      generateSecret: true,
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: false,
          clientCredentials: true,
        },
        scopes: [OAuthScope.resourceServer(this.resouceServer, this.totpScope)],
        callbackUrls: ["https://example.com"],
      },
      userPoolClientName: "amfasys_clientcredentials",
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
    });
  }

  // // Import admin users using custom resource
  // private importAdminUsers() {
  //   // Create Lambda function for importing users
  //   const importUsersLambda = new Function(this.scope, "ImportUsersLambda", {
  //     runtime: Runtime.NODEJS_LATEST,
  //     handler: "index.handler",
  //     timeout: Duration.minutes(5),
  //     code: Code.fromAsset("cdk/lambda/importusers"),
  //   });

  //   // Grant Cognito permissions to the Lambda
  //   importUsersLambda.role?.attachInlinePolicy(
  //     new Policy(this.scope, "ImportUsersPolicy", {
  //       statements: [
  //         new PolicyStatement({
  //           actions: [
  //             "cognito-idp:AdminCreateUser",
  //             "cognito-idp:AdminSetUserPassword",
  //             "cognito-idp:AdminGetUser",
  //             "cognito-idp:AdminUpdateUserAttributes",
  //           ],
  //           resources: [this.adminUserpool.userPoolArn],
  //         }),
  //       ],
  //     }),
  //   );

  //   // Create custom resource provider
  //   const importUsersProvider = new Provider(
  //     this.scope,
  //     "ImportUsersProvider",
  //     {
  //       onEventHandler: importUsersLambda,
  //     },
  //   );

  //   // Default admin users to import
  //   const defaultAdminUsers = [
  //     {
  //       username: "admin@example.com",
  //       email: "admin@example.com",
  //       temporaryPassword: "TempPass123!",
  //       permanentPassword: "AdminPass123!",
  //     },
  //   ];

  //   // Create custom resource to import users
  //   new CustomResource(this.scope, "ImportUsersCustomResource", {
  //     serviceToken: importUsersProvider.serviceToken,
  //     properties: {
  //       UserPoolId: this.adminUserpool.userPoolId,
  //       Users: JSON.stringify(defaultAdminUsers),
  //     },
  //   });
  // }
}
