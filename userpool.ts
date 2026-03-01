import { Construct } from 'constructs';
import {
  UserPool,
  UserPoolClient,
  OAuthScope,
  AccountRecovery,
  UserPoolIdentityProviderOidc,
  ProviderAttribute,
  OidcAttributeRequestMethod,
  UserPoolOperation,
  Mfa,
  UserPoolClientIdentityProvider,
  StringAttribute,
  ResourceServerScope,
  UserPoolResourceServer,
  UserPoolDomain,
  ClientAttributes,
} from 'aws-cdk-lib/aws-cognito';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Duration } from 'aws-cdk-lib';


import { AMFAIdPName, resourceName, totpScopeName, RootDomainName, AMFAUserPoolName } from './const';
import { createAuthChallengeFn, createCustomEmailSenderLambda } from './lambda';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

export class TenantUserPool {
  scope: Construct;
  region: string | undefined;
  userpool: UserPool;
  hostedUIClient: UserPoolClient;
  customAuthClient: UserPoolClient;
  secretClient: UserPoolClient;
  clientCredentialsClient: UserPoolClient;
  oidcProvider: UserPoolIdentityProviderOidc;
  api: RestApi;
  tenantId: string;
  totpScope: ResourceServerScope;
  resouceServer: UserPoolResourceServer;
  userpoolDomain: UserPoolDomain;
  rootDomainName: string | undefined;
  customSenderKey: Key;



  constructor(scope: Construct, configTable: Table, region: string | undefined, tenantId: string | undefined,
    magicString: string, callbackUrls: string[], logoutUrls: string[],
    spPortalUrl: string | undefined, rootDomainName: string | undefined, smtpScrets: Secret) {
    this.scope = scope;
    this.region = region;
    this.tenantId = tenantId ? tenantId : '';
    this.rootDomainName = rootDomainName ? rootDomainName : '';

    this.customSenderKey = this.createCustomSenderKey();
    this.userpool = this.createUserPool();
    this.userpool.node.addDependency(this.customSenderKey);

    this.customAuthClient = this.addCustomAuthClient();
    this.addCustomAuthLambdaTriggers(magicString);
    this.oidcProvider = this.createOIDCProvider();
    this.hostedUIClient = this.addHostedUIAppClient(callbackUrls, logoutUrls);
    this.hostedUIClient.node.addDependency(this.oidcProvider);
    this.userpoolDomain = this.addHostedUIDomain();
    this.userpoolDomain.node.addDependency(this.userpool);

    this.addCustomEmailSenderLambdaTrigger(configTable, spPortalUrl, smtpScrets);
    this.clientCredentialsClient = this.addClientCredentialClient();
  }

  private createCustomSenderKey = () => {
    let newKey = new Key(this.scope, 'customSenderKey', {
      enableKeyRotation: true,
      description: 'customSenderKey',
    });

    newKey.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal('cognito-idp.amazonaws.com')],
        actions: ['kms:CreateGrant', 'kms:Encrypt'],
        resources: ['*'],
      })
    );

    return newKey
  }

  private createUserPool = () => {
    this.totpScope = new ResourceServerScope({ scopeName: totpScopeName, scopeDescription: totpScopeName });

    const myuserpool = new UserPool(this.scope, `amfa-userpool`, {
      userPoolName: AMFAUserPoolName,
      // use self sign-in is disable by default
      selfSignUpEnabled: true,
      signInAliases: {
        // username sign-in
        username: true,
        // email as username
        email: true,
        phone: false,
      },
      // signInCaseSensitive: false,
      // user attributes
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: {
        "alter-email": new StringAttribute({ mutable: true }),
        "voice-number": new StringAttribute({ mutable: true }),
        "totp-label": new StringAttribute({ mutable: true }),
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
      mfa: Mfa.OPTIONAL,
      // forgotPassword recovery method, phone by default
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      customSenderKmsKey: this.customSenderKey,
    });

    this.resouceServer = myuserpool.addResourceServer('AMFAResourceServer', {
      identifier: resourceName,
      scopes: [this.totpScope],
    });

    return myuserpool;
  }

  private addCustomAuthClient() {
    return new UserPoolClient(this.scope, 'customAuthClient', {
      userPool: this.userpool,
      generateSecret: true,
      preventUserExistenceErrors: true,
      authFlows: {
        // enable custom auth flow
        custom: true,
        userSrp: true,
        adminUserPassword: true,
      },
      userPoolClientName: 'customAuthClient',
    });
  };

  private addHostedUIAppClient(callbackUrls: string[], logoutUrls: string[]) {
    const writeAttributes = new ClientAttributes()
      .withStandardAttributes({
        email: true,
        profilePicture: true,
      });

    const readAttributes = (new ClientAttributes()).withStandardAttributes({
      address: true, email: true, emailVerified: true,
      phoneNumber: true, phoneNumberVerified: true,
      birthdate: true, givenName: true, familyName: true, gender: true,
      middleName: true, profilePicture: true, profilePage: true
    });

    return new UserPoolClient(this.scope, 'hostedUIClient', {
      userPool: this.userpool,
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
      readAttributes,
      writeAttributes,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [OAuthScope.OPENID, OAuthScope.PROFILE/*, OAuthScope.COGNITO_ADMIN*/],
        callbackUrls,
        logoutUrls,
      },
      userPoolClientName: 'amfasys_hostedUIClient',
      supportedIdentityProviders: [UserPoolClientIdentityProvider.custom(AMFAIdPName)]
    });
  };

  private addClientCredentialClient() {
    return new UserPoolClient(this.scope, 'clientcredentialsClient', {
      userPool: this.userpool,
      generateSecret: true,
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: false,
          clientCredentials: true
        },
        scopes: [OAuthScope.resourceServer(this.resouceServer, this.totpScope)],
        callbackUrls: ["https://example.com"],
      },
      userPoolClientName: 'amfasys_clientcredentials',
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
    });
  };


  private createOIDCProvider() {
    const issuerUrl = `https://cognito-idp.${this.region}.amazonaws.com/${this.userpool.userPoolId}`;
    const customauthUrl = `https://${this.tenantId}.${RootDomainName}`;
    const serviceApiUrl = `https://api.${this.tenantId}.${RootDomainName}`;

    const str = this.rootDomainName?.replace(/\./g, '').toLowerCase();
    let hash = 0
    if (str) {
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
      }
    }

    return new UserPoolIdentityProviderOidc(
      this.scope,
      'Amfa-OIDCProvider',
      {
        clientId: this.customAuthClient.userPoolClientId,
        clientSecret: this.customAuthClient.userPoolClientSecret.unsafeUnwrap(),
        issuerUrl,
        userPool: this.userpool,
        // the properties below are optional
        attributeMapping: {
          email: ProviderAttribute.other('email'),
          phoneNumber: ProviderAttribute.other('phone_number'),
          familyName: ProviderAttribute.other('family_name'),
          givenName: ProviderAttribute.other('given_name'),
          nickname: ProviderAttribute.other('nickname'),
          custom: {
            email_verified: ProviderAttribute.other('email_verified'),
            phone_number_verified: ProviderAttribute.other('phone_number_verified'),
            'custom:alter-email': ProviderAttribute.other('custom:alter-email'),
            'custom:voice-number': ProviderAttribute.other('custom:voice-number')
          },
        },
        attributeRequestMethod: OidcAttributeRequestMethod.GET,
        endpoints: {
          authorization: `${customauthUrl}/oauth2/authorize`,
          jwksUri: `${issuerUrl}/.well-known/jwks.json`,
          token: `${serviceApiUrl}/oauth2/token`,
          userInfo: `https://${this.tenantId}-${(hash >>> 0).toString(36)}.auth.${this.region}.amazoncognito.com/oauth2/userInfo`,
        },
        identifiers: ['apersona'],
        name: AMFAIdPName,
        scopes: ['openid profile'],
      }
    );
  };

  private addCustomAuthLambdaTriggers(magicString: string) {
    const authChallengeFnsConfig = [
      { name: 'createauthchallenge', runtime: Runtime.PYTHON_3_12 },
      { name: 'defineauthchallenge', runtime: Runtime.NODEJS_20_X },
      { name: 'verifyauthchallenge', runtime: Runtime.NODEJS_20_X },
    ];
    const authChallengeFns = authChallengeFnsConfig.map((fn) =>
      createAuthChallengeFn(this.scope, fn.name, fn.runtime, this.tenantId, magicString)
    );

    this.userpool.addTrigger(
      UserPoolOperation.CREATE_AUTH_CHALLENGE,
      authChallengeFns[0]
    );
    this.userpool.addTrigger(
      UserPoolOperation.DEFINE_AUTH_CHALLENGE,
      authChallengeFns[1]
    );
    this.userpool.addTrigger(
      UserPoolOperation.VERIFY_AUTH_CHALLENGE_RESPONSE,
      authChallengeFns[2]
    );
  };

  private addCustomEmailSenderLambdaTrigger(configTable, spPortalUrl, smtpScrets) {
    const lambdaFn = createCustomEmailSenderLambda(
      this.scope, configTable, this.tenantId, spPortalUrl, smtpScrets
    );

    this.customSenderKey.grantDecrypt(lambdaFn);

    this.userpool.addTrigger(
      UserPoolOperation.CUSTOM_EMAIL_SENDER,
      lambdaFn
    );
  }

  private addHostedUIDomain(
  ) {
    const str = this.rootDomainName?.replace(/\./g, '').toLowerCase();
    let hash = 0
    if (str) {
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
      }
    }

    return this.userpool.addDomain('amfaHostedUI-domain', {
      cognitoDomain: {
        domainPrefix: `${this.tenantId}-${(hash >>> 0).toString(36)}`,
      },
    });
  };

}
