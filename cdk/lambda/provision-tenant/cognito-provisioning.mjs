/**
 * Cognito Provisioning Module
 * 
 * Creates Cognito UserPool and clients for tenant authentication.
 * - UserPool for user management
 * - SAML client for SAML integration
 * - SP Portal client for SP portal access
 */

import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  CreateUserPoolDomainCommand,
  DescribeUserPoolCommand
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

/**
 * Provision Cognito resources for tenant
 * 
 * @param {Object} tenantData - Validated tenant data
 * @param {Object} asmData - ASM registration data
 * @returns {Object} Cognito resource IDs and configuration
 */
export async function provisionCognitoResources(tenantData, asmData) {
  const { tenantId, tenantName } = tenantData;
  
  console.log(`[Cognito] Starting provisioning for tenant: ${tenantId}`);
  
  // 1. Create UserPool
  const userPoolResult = await createUserPool(tenantId, tenantName);
  console.log(`[Cognito] UserPool created: ${userPoolResult.userPoolId}`);
  
  // 2. Create UserPool Domain for OAuth
  const domainName = await createUserPoolDomain(userPoolResult.userPoolId, tenantId);
  console.log(`[Cognito] UserPool domain created: ${domainName}`);
  
  // 3. Create SAML client
  const samlClient = await createSAMLClient(userPoolResult.userPoolId, tenantId, tenantName);
  console.log(`[Cognito] SAML client created: ${samlClient.clientId}`);
  
  // 4. Create SP Portal client
  const spPortalClient = await createSPPortalClient(userPoolResult.userPoolId, tenantId, tenantName);
  console.log(`[Cognito] SP Portal client created: ${spPortalClient.clientId}`);
  
  // 5. Return all resource information
  return {
    userPoolId: userPoolResult.userPoolId,
    userPoolArn: userPoolResult.userPoolArn,
    userPoolDomain: domainName,
    oauthDomain: `${domainName}.auth.${process.env.AWS_REGION}.amazoncognito.com`,
    samlClientId: samlClient.clientId,
    samlClientSecret: samlClient.clientSecret,
    spPortalClientId: spPortalClient.clientId,
    region: process.env.AWS_REGION
  };
}

/**
 * Create Cognito UserPool
 */
async function createUserPool(tenantId, tenantName) {
  const poolName = `${tenantName}-userpool-${tenantId}`;
  
  const command = new CreateUserPoolCommand({
    PoolName: poolName,
    Policies: {
      PasswordPolicy: {
        MinimumLength: 8,
        RequireUppercase: true,
        RequireLowercase: true,
        RequireNumbers: true,
        RequireSymbols: true,
        TemporaryPasswordValidityDays: 7
      }
    },
    MfaConfiguration: 'OPTIONAL',
    AutoVerifiedAttributes: ['email'],
    UsernameAttributes: ['email'],
    UsernameConfiguration: {
      CaseSensitive: false
    },
    Schema: [
      {
        Name: 'email',
        AttributeDataType: 'String',
        Required: true,
        Mutable: true
      },
      {
        Name: 'name',
        AttributeDataType: 'String',
        Required: false,
        Mutable: true
      },
      {
        Name: 'family_name',
        AttributeDataType: 'String',
        Required: false,
        Mutable: true
      }
    ],
    EmailConfiguration: {
      EmailSendingAccount: 'COGNITO_DEFAULT'
    },
    AdminCreateUserConfig: {
      AllowAdminCreateUserOnly: false,
      InviteMessageTemplate: {
        EmailSubject: `Welcome to ${tenantName}`,
        EmailMessage: 'Your username is {username} and temporary password is {####}'
      }
    },
    UserPoolTags: {
      TenantId: tenantId,
      TenantName: tenantName,
      ManagedBy: 'provision-tenant-lambda'
    },
    AccountRecoverySetting: {
      RecoveryMechanisms: [
        {
          Priority: 1,
          Name: 'verified_email'
        }
      ]
    }
  });
  
  const response = await cognito.send(command);
  
  return {
    userPoolId: response.UserPool.Id,
    userPoolArn: response.UserPool.Arn
  };
}

/**
 * Create UserPool Domain for OAuth
 */
async function createUserPoolDomain(userPoolId, tenantId) {
  // Create unique domain name (lowercase, alphanumeric only)
  const domainName = `${tenantId}-${Date.now()}`.toLowerCase();
  
  const command = new CreateUserPoolDomainCommand({
    Domain: domainName,
    UserPoolId: userPoolId
  });
  
  await cognito.send(command);
  
  return domainName;
}

/**
 * Create SAML client for SAML integration
 */
async function createSAMLClient(userPoolId, tenantId, tenantName) {
  const clientName = `${tenantName}-saml-client`;
  const rootDomain = process.env.ROOT_DOMAIN;
  
  const command = new CreateUserPoolClientCommand({
    UserPoolId: userPoolId,
    ClientName: clientName,
    GenerateSecret: true,
    RefreshTokenValidity: 30,
    AccessTokenValidity: 60,
    IdTokenValidity: 60,
    TokenValidityUnits: {
      RefreshToken: 'days',
      AccessToken: 'minutes',
      IdToken: 'minutes'
    },
    ReadAttributes: [
      'email',
      'email_verified',
      'name',
      'family_name'
    ],
    WriteAttributes: [
      'email',
      'name',
      'family_name'
    ],
    ExplicitAuthFlows: [
      'ALLOW_USER_PASSWORD_AUTH',
      'ALLOW_REFRESH_TOKEN_AUTH',
      'ALLOW_USER_SRP_AUTH'
    ],
    SupportedIdentityProviders: ['COGNITO'],
    AllowedOAuthFlows: ['code', 'implicit'],
    AllowedOAuthScopes: ['openid', 'email', 'profile'],
    AllowedOAuthFlowsUserPoolClient: true,
    CallbackURLs: [
      `https://${tenantId}.${rootDomain}/callback`,
      `https://${tenantId}.${rootDomain}/saml/callback`
    ],
    LogoutURLs: [
      `https://${tenantId}.${rootDomain}/logout`
    ],
    PreventUserExistenceErrors: 'ENABLED'
  });
  
  const response = await cognito.send(command);
  
  return {
    clientId: response.UserPoolClient.ClientId,
    clientSecret: response.UserPoolClient.ClientSecret
  };
}

/**
 * Create SP Portal client for user authentication
 */
async function createSPPortalClient(userPoolId, tenantId, tenantName) {
  const clientName = `${tenantName}-sp-portal-client`;
  const rootDomain = process.env.ROOT_DOMAIN;
  
  const command = new CreateUserPoolClientCommand({
    UserPoolId: userPoolId,
    ClientName: clientName,
    GenerateSecret: false, // Public client for frontend
    RefreshTokenValidity: 30,
    AccessTokenValidity: 60,
    IdTokenValidity: 60,
    TokenValidityUnits: {
      RefreshToken: 'days',
      AccessToken: 'minutes',
      IdToken: 'minutes'
    },
    ReadAttributes: [
      'email',
      'email_verified',
      'name',
      'family_name'
    ],
    WriteAttributes: [
      'email',
      'name',
      'family_name'
    ],
    ExplicitAuthFlows: [
      'ALLOW_USER_SRP_AUTH',
      'ALLOW_REFRESH_TOKEN_AUTH'
    ],
    SupportedIdentityProviders: ['COGNITO'],
    AllowedOAuthFlows: ['implicit', 'code'],
    AllowedOAuthScopes: ['openid', 'email', 'profile'],
    AllowedOAuthFlowsUserPoolClient: true,
    CallbackURLs: [
      `https://${tenantId}.${rootDomain}/`,
      `https://${tenantId}.${rootDomain}/callback`,
      'http://localhost:3000/', // For local development
      'http://localhost:3000/callback'
    ],
    LogoutURLs: [
      `https://${tenantId}.${rootDomain}/`,
      'http://localhost:3000/'
    ],
    PreventUserExistenceErrors: 'ENABLED'
  });
  
  const response = await cognito.send(command);
  
  return {
    clientId: response.UserPoolClient.ClientId
  };
}

/**
 * Verify UserPool exists and is active
 */
export async function verifyUserPool(userPoolId) {
  try {
    const command = new DescribeUserPoolCommand({
      UserPoolId: userPoolId
    });
    
    const response = await cognito.send(command);
    return response.UserPool.Status === 'Enabled';
    
  } catch (error) {
    console.error(`[Cognito] Failed to verify UserPool ${userPoolId}:`, error);
    return false;
  }
}

export default provisionCognitoResources;
