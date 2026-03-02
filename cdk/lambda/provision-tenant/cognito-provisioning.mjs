/**
 * Cognito Provisioning Module
 *
 * Creates Cognito UserPool and clients for tenant authentication.
 * Mirrors the original CDK userpool.ts with runtime provisioning:
 *
 * - UserPool with custom attributes and MFA
 * - UserPool Domain (deterministic prefix)
 * - Custom Auth Client (secret, for OIDC provider)
 * - OIDC Identity Provider ('apersona')
 * - SAML Client (for SAML integration)
 * - Hosted UI Client (uses OIDC provider)
 * - Lambda Triggers (custom auth + custom email sender)
 */

import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  CreateUserPoolDomainCommand,
  CreateIdentityProviderCommand,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
  SetUserPoolMfaConfigCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import {
  LambdaClient,
  AddPermissionCommand,
} from "@aws-sdk/client-lambda";

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

const lambda = new LambdaClient({
  region: process.env.AWS_REGION,
});

/** OIDC Identity Provider name - must match the original CDK constant */
const AMFA_IDP_NAME = "apersona";

/**
 * Compute deterministic domain hash from root domain.
 * Matches the CDK userpool.ts hash algorithm exactly.
 */
function getDomainHash(rootDomain) {
  const str = (rootDomain || "").replace(/\./g, "").toLowerCase();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Provision Cognito resources for tenant
 *
 * Full provisioning flow matching original CDK userpool.ts:
 * 1. UserPool
 * 2. UserPool Domain (deterministic)
 * 3. Custom Auth Client (secret, for OIDC provider)
 * 4. OIDC Identity Provider ('apersona')
 * 5. SAML Client
 * 6. Hosted UI Client (uses OIDC provider)
 * 7. Lambda Triggers (4 triggers)
 *
 * @param {Object} tenantData - Validated tenant data
 * @param {Object} asmData - ASM registration data
 * @returns {Object} Cognito resource IDs and configuration
 */
export async function provisionCognitoResources(tenantData, asmData) {
  const { tenantId, tenantName } = tenantData;
  const rootDomain = process.env.ROOT_DOMAIN_NAME || "";
  const region = process.env.AWS_REGION || "";

  console.log(`[Cognito] Starting provisioning for tenant: ${tenantId}`);

  // 1. Create UserPool
  const userPoolResult = await createUserPool(tenantId, tenantName);
  console.log(`[Cognito] UserPool created: ${userPoolResult.userPoolId}`);

  // 2. Create UserPool Domain (deterministic)
  const domainName = await createUserPoolDomain(
    userPoolResult.userPoolId,
    tenantId,
    rootDomain,
  );
  console.log(`[Cognito] UserPool domain created: ${domainName}`);

  // 3. Create Custom Auth Client (secret client for OIDC provider)
  const customAuthClient = await createCustomAuthClient(
    userPoolResult.userPoolId,
    tenantId,
  );
  console.log(`[Cognito] Custom auth client created: ${customAuthClient.clientId}`);

  // 4. Create OIDC Identity Provider ('apersona')
  await createOIDCProvider(
    userPoolResult.userPoolId,
    tenantId,
    domainName,
    customAuthClient.clientId,
    customAuthClient.clientSecret,
    rootDomain,
    region,
  );
  console.log(`[Cognito] OIDC provider '${AMFA_IDP_NAME}' created`);

  // 5. Create SAML client
  const samlClient = await createSAMLClient(
    userPoolResult.userPoolId,
    tenantId,
    tenantName,
  );
  console.log(`[Cognito] SAML client created: ${samlClient.clientId}`);

  // 6. Create Hosted UI Client (uses OIDC provider)
  const hostedUIClient = await createHostedUIClient(
    userPoolResult.userPoolId,
    tenantId,
    tenantName,
  );
  console.log(`[Cognito] Hosted UI client created: ${hostedUIClient.clientId}`);

  // 7. Attach Lambda Triggers
  await attachLambdaTriggers(userPoolResult.userPoolId, tenantId);
  console.log(`[Cognito] Lambda triggers attached`);

  // 8. Return all resource information
  return {
    userPoolId: userPoolResult.userPoolId,
    userPoolArn: userPoolResult.userPoolArn,
    userPoolDomain: domainName,
    oauthDomain: `${domainName}.auth.${region}.amazoncognito.com`,
    customAuthClientId: customAuthClient.clientId,
    customAuthClientSecret: customAuthClient.clientSecret,
    samlClientId: samlClient.clientId,
    samlClientSecret: samlClient.clientSecret,
    spPortalClientId: hostedUIClient.clientId,
    region,
  };
}

/**
 * Create Cognito UserPool
 * Matches CDK userpool.ts createUserPool() configuration
 */
async function createUserPool(tenantId, tenantName) {
  const poolName = `${tenantId}-aP-AWS-UserPool`;

  const command = new CreateUserPoolCommand({
    PoolName: poolName,
    Policies: {
      PasswordPolicy: {
        MinimumLength: 8,
        RequireUppercase: true,
        RequireLowercase: true,
        RequireNumbers: true,
        RequireSymbols: true,
        TemporaryPasswordValidityDays: 30,
      },
    },
    MfaConfiguration: "OFF", // Will be set to OPTIONAL after creation
    AutoVerifiedAttributes: ["email"],
    UsernameAttributes: ["email"],
    UsernameConfiguration: {
      CaseSensitive: false,
    },
    Schema: [
      {
        Name: "email",
        AttributeDataType: "String",
        Required: true,
        Mutable: true,
      },
      {
        Name: "name",
        AttributeDataType: "String",
        Required: false,
        Mutable: true,
      },
      {
        Name: "family_name",
        AttributeDataType: "String",
        Required: false,
        Mutable: true,
      },
      // Custom attributes (from CDK UserPool)
      {
        Name: "alter-email",
        AttributeDataType: "String",
        Mutable: true,
        DeveloperOnlyAttribute: false,
      },
      {
        Name: "voice-number",
        AttributeDataType: "String",
        Mutable: true,
        DeveloperOnlyAttribute: false,
      },
      {
        Name: "totp-label",
        AttributeDataType: "String",
        Mutable: true,
        DeveloperOnlyAttribute: false,
      },
    ],
    EmailConfiguration: {
      EmailSendingAccount: "COGNITO_DEFAULT",
    },
    AdminCreateUserConfig: {
      AllowAdminCreateUserOnly: false, // Allow self sign-up
      InviteMessageTemplate: {
        EmailSubject: `Welcome to ${tenantName}`,
        EmailMessage:
          "Your username is {username} and temporary password is {####}",
      },
    },
    UserPoolTags: {
      TenantId: tenantId,
      TenantName: tenantName,
      ManagedBy: "provision-tenant-lambda",
    },
    AccountRecoverySetting: {
      RecoveryMechanisms: [
        {
          Priority: 1,
          Name: "verified_email",
        },
      ],
    },
  });

  const response = await cognito.send(command);

  // Set MFA to OPTIONAL with TOTP (matches CDK: mfa: Mfa.OPTIONAL)
  await cognito.send(
    new SetUserPoolMfaConfigCommand({
      UserPoolId: response.UserPool.Id,
      MfaConfiguration: "OPTIONAL",
      SoftwareTokenMfaConfiguration: { Enabled: true },
    }),
  );

  return {
    userPoolId: response.UserPool.Id,
    userPoolArn: response.UserPool.Arn,
  };
}

/**
 * Create UserPool Domain with deterministic prefix
 * Matches CDK userpool.ts addHostedUIDomain() hash algorithm
 */
async function createUserPoolDomain(userPoolId, tenantId, rootDomain) {
  const hash = getDomainHash(rootDomain);
  const domainName = `${tenantId}-${hash}`;

  const command = new CreateUserPoolDomainCommand({
    Domain: domainName,
    UserPoolId: userPoolId,
  });

  await cognito.send(command);

  return domainName;
}

/**
 * Create Custom Auth Client
 * Matches CDK userpool.ts addCustomAuthClient()
 *
 * This is a SECRET client used by the OIDC Identity Provider.
 * Enables custom auth flow (magic link / passwordless).
 */
async function createCustomAuthClient(userPoolId, tenantId) {
  const command = new CreateUserPoolClientCommand({
    UserPoolId: userPoolId,
    ClientName: "customAuthClient",
    GenerateSecret: true,
    PreventUserExistenceErrors: "ENABLED",
    ExplicitAuthFlows: [
      "ALLOW_CUSTOM_AUTH",
      "ALLOW_USER_SRP_AUTH",
      "ALLOW_ADMIN_USER_PASSWORD_AUTH",
      "ALLOW_REFRESH_TOKEN_AUTH",
    ],
    // No OAuth config - this is a pure API client used by the OIDC provider
  });

  const response = await cognito.send(command);

  return {
    clientId: response.UserPoolClient.ClientId,
    clientSecret: response.UserPoolClient.ClientSecret,
  };
}

/**
 * Create OIDC Identity Provider ('apersona')
 * Matches CDK userpool.ts createOIDCProvider()
 *
 * This is the core of the AMFA custom auth flow.
 * The hosted UI redirects through this provider.
 */
async function createOIDCProvider(
  userPoolId,
  tenantId,
  domainName,
  customAuthClientId,
  customAuthClientSecret,
  rootDomain,
  region,
) {
  const issuerUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const amfaServiceUrl = `https://${tenantId}.idapersona.${rootDomain}`;
  const sharedApiUrl = `https://api.${rootDomain}`;
  const userInfoUrl = `https://${domainName}.auth.${region}.amazoncognito.com/oauth2/userInfo`;

  const command = new CreateIdentityProviderCommand({
    UserPoolId: userPoolId,
    ProviderName: AMFA_IDP_NAME,
    ProviderType: "OIDC",
    ProviderDetails: {
      client_id: customAuthClientId,
      client_secret: customAuthClientSecret,
      oidc_issuer: issuerUrl,
      authorize_scopes: "openid profile",
      authorize_url: `${amfaServiceUrl}/oauth2/authorize`,
      token_url: `${sharedApiUrl}/oauth2/token`,
      jwks_uri: `${issuerUrl}/.well-known/jwks.json`,
      attributes_url: userInfoUrl,
      attributes_url_add_attributes: "false",
      attributes_request_method: "GET",
    },
    AttributeMapping: {
      email: "email",
      phone_number: "phone_number",
      family_name: "family_name",
      given_name: "given_name",
      nickname: "nickname",
      email_verified: "email_verified",
      phone_number_verified: "phone_number_verified",
      "custom:alter-email": "custom:alter-email",
      "custom:voice-number": "custom:voice-number",
    },
    IdpIdentifiers: ["apersona"],
  });

  await cognito.send(command);
}

/**
 * Create SAML client for SAML integration
 * (This client existed before - keeping it as is)
 */
async function createSAMLClient(userPoolId, tenantId, tenantName) {
  const clientName = `${tenantName}-saml-client`;
  const rootDomain = process.env.ROOT_DOMAIN_NAME;

  const command = new CreateUserPoolClientCommand({
    UserPoolId: userPoolId,
    ClientName: clientName,
    GenerateSecret: true,
    RefreshTokenValidity: 30,
    AccessTokenValidity: 60,
    IdTokenValidity: 60,
    TokenValidityUnits: {
      RefreshToken: "days",
      AccessToken: "minutes",
      IdToken: "minutes",
    },
    ReadAttributes: ["email", "email_verified", "name", "family_name"],
    WriteAttributes: ["email", "name", "family_name"],
    ExplicitAuthFlows: [
      "ALLOW_USER_PASSWORD_AUTH",
      "ALLOW_REFRESH_TOKEN_AUTH",
      "ALLOW_USER_SRP_AUTH",
    ],
    SupportedIdentityProviders: ["COGNITO"],
    AllowedOAuthFlows: ["code", "implicit"],
    AllowedOAuthScopes: ["openid", "email", "profile"],
    AllowedOAuthFlowsUserPoolClient: true,
    CallbackURLs: [
      `https://${tenantId}.idapersona.${rootDomain}/callback`,
      `https://${tenantId}.idapersona.${rootDomain}/saml/callback`,
    ],
    LogoutURLs: [`https://${tenantId}.idapersona.${rootDomain}/logout`],
    PreventUserExistenceErrors: "ENABLED",
  });

  const response = await cognito.send(command);

  return {
    clientId: response.UserPoolClient.ClientId,
    clientSecret: response.UserPoolClient.ClientSecret,
  };
}

/**
 * Create Hosted UI Client
 * Matches CDK userpool.ts addHostedUIAppClient()
 *
 * Uses the 'apersona' OIDC provider (NOT 'COGNITO').
 * Authorization code grant only.
 */
async function createHostedUIClient(userPoolId, tenantId, tenantName) {
  const rootDomain = process.env.ROOT_DOMAIN_NAME;

  // Callback URLs - include both login (SP Portal) and idapersona (AMFA Service) domains
  const callbackUrls = [
    `https://${tenantId}.login.${rootDomain}/`,
    `https://${tenantId}.login.${rootDomain}/auth-callback`,
    `https://${tenantId}.idapersona.${rootDomain}/`,
    `https://${tenantId}.idapersona.${rootDomain}/callback`,
    "http://localhost:3000/",
    "http://localhost:3000/auth-callback",
  ];

  const logoutUrls = [
    `https://${tenantId}.login.${rootDomain}/`,
    `https://${tenantId}.idapersona.${rootDomain}/`,
    "http://localhost:3000/",
  ];

  const command = new CreateUserPoolClientCommand({
    UserPoolId: userPoolId,
    ClientName: "amfasys_hostedUIClient",
    GenerateSecret: false, // Public client for frontend
    ExplicitAuthFlows: [
      "ALLOW_USER_SRP_AUTH",
      "ALLOW_REFRESH_TOKEN_AUTH",
    ],
    // Rich read attributes matching CDK original
    ReadAttributes: [
      "address",
      "email",
      "email_verified",
      "phone_number",
      "phone_number_verified",
      "birthdate",
      "given_name",
      "family_name",
      "gender",
      "middle_name",
      "picture",
      "profile",
    ],
    WriteAttributes: ["email", "picture"],
    SupportedIdentityProviders: [AMFA_IDP_NAME], // Uses 'apersona' OIDC provider
    AllowedOAuthFlows: ["code"], // Authorization code grant only
    AllowedOAuthScopes: ["openid", "profile"],
    AllowedOAuthFlowsUserPoolClient: true,
    CallbackURLs: callbackUrls,
    LogoutURLs: logoutUrls,
    PreventUserExistenceErrors: "ENABLED",
  });

  const response = await cognito.send(command);

  return {
    clientId: response.UserPoolClient.ClientId,
  };
}

/**
 * Attach Lambda Triggers to UserPool
 * Matches CDK userpool.ts triggers:
 * - CREATE_AUTH_CHALLENGE
 * - DEFINE_AUTH_CHALLENGE
 * - VERIFY_AUTH_CHALLENGE_RESPONSE
 * - CUSTOM_EMAIL_SENDER (with KMS key)
 *
 * Uses DescribeUserPool + UpdateUserPool to merge LambdaConfig.
 */
async function attachLambdaTriggers(userPoolId, tenantId) {
  const createAuthChallengeArn = process.env.CREATE_AUTH_CHALLENGE_LAMBDA_ARN;
  const defineAuthChallengeArn = process.env.DEFINE_AUTH_CHALLENGE_LAMBDA_ARN;
  const verifyAuthChallengeArn = process.env.VERIFY_AUTH_CHALLENGE_LAMBDA_ARN;
  const customEmailSenderArn = process.env.CUSTOM_EMAIL_SENDER_LAMBDA_ARN;
  const customSenderKmsKeyArn = process.env.CUSTOM_SENDER_KMS_KEY_ARN;

  if (!createAuthChallengeArn || !defineAuthChallengeArn || !verifyAuthChallengeArn) {
    console.warn("[Cognito] Lambda trigger ARNs not configured, skipping trigger attachment");
    return;
  }

  // First, grant Cognito permission to invoke each Lambda
  await grantCognitoInvokePermission(createAuthChallengeArn, userPoolId, tenantId, "CreateAuthChallenge");
  await grantCognitoInvokePermission(defineAuthChallengeArn, userPoolId, tenantId, "DefineAuthChallenge");
  await grantCognitoInvokePermission(verifyAuthChallengeArn, userPoolId, tenantId, "VerifyAuthChallenge");

  if (customEmailSenderArn) {
    await grantCognitoInvokePermission(customEmailSenderArn, userPoolId, tenantId, "CustomEmailSender");
  }

  // Get current UserPool configuration
  const describeResponse = await cognito.send(
    new DescribeUserPoolCommand({ UserPoolId: userPoolId })
  );

  const currentPool = describeResponse.UserPool;

  // Build LambdaConfig
  const lambdaConfig = {
    CreateAuthChallenge: createAuthChallengeArn,
    DefineAuthChallenge: defineAuthChallengeArn,
    VerifyAuthChallengeResponse: verifyAuthChallengeArn,
  };

  // Add Custom Email Sender if configured
  if (customEmailSenderArn && customSenderKmsKeyArn) {
    lambdaConfig.CustomEmailSender = {
      LambdaArn: customEmailSenderArn,
      LambdaVersion: "V1_0",
    };
    lambdaConfig.KMSKeyID = customSenderKmsKeyArn;
  }

  // UpdateUserPool - need to pass back essential pool config
  // (UpdateUserPool replaces config, so we must preserve existing settings)
  const updateCommand = new UpdateUserPoolCommand({
    UserPoolId: userPoolId,
    LambdaConfig: lambdaConfig,
    // Preserve existing settings
    Policies: currentPool.Policies,
    AutoVerifiedAttributes: currentPool.AutoVerifiedAttributes,
    MfaConfiguration: currentPool.MfaConfiguration,
    AccountRecoverySetting: currentPool.AccountRecoverySetting,
    AdminCreateUserConfig: currentPool.AdminCreateUserConfig,
    UserPoolTags: currentPool.UserPoolTags,
    EmailConfiguration: currentPool.EmailConfiguration,
  });

  await cognito.send(updateCommand);

  console.log(`[Cognito] Lambda triggers attached to UserPool ${userPoolId}`);
}

/**
 * Grant Cognito permission to invoke a Lambda function
 * Required for Lambda triggers to work
 */
async function grantCognitoInvokePermission(lambdaArn, userPoolId, tenantId, triggerName) {
  try {
    const command = new AddPermissionCommand({
      FunctionName: lambdaArn,
      StatementId: `CognitoTrigger-${tenantId}-${triggerName}`,
      Action: "lambda:InvokeFunction",
      Principal: "cognito-idp.amazonaws.com",
      SourceArn: `arn:aws:cognito-idp:${process.env.AWS_REGION}:${process.env.ACCOUNT_ID}:userpool/${userPoolId}`,
    });

    await lambda.send(command);
    console.log(`[Cognito] Granted invoke permission for ${triggerName} on tenant ${tenantId}`);
  } catch (error) {
    // Permission may already exist if Lambda is shared across tenants
    if (error.name === "ResourceConflictException") {
      console.log(`[Cognito] Invoke permission already exists for ${triggerName} on tenant ${tenantId}`);
    } else {
      console.warn(`[Cognito] Failed to grant invoke permission for ${triggerName}:`, error.message);
      // Don't throw - triggers can still work if permission was previously granted
    }
  }
}

/**
 * Verify UserPool exists and is active
 */
export async function verifyUserPool(userPoolId) {
  try {
    const command = new DescribeUserPoolCommand({
      UserPoolId: userPoolId,
    });

    const response = await cognito.send(command);
    return response.UserPool.Status === "Enabled";
  } catch (error) {
    console.error(`[Cognito] Failed to verify UserPool ${userPoolId}:`, error);
    return false;
  }
}

export default provisionCognitoResources;