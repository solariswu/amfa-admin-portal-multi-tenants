/**
 * ASM Registration Module
 *
 * Manages ASM credentials at two levels:
 *
 * 1. Organization level (Service Provider):
 *    - Each org registers once via createServiceProvider.ap
 *    - Returns serviceProviderId + asmSecretKey
 *    - Stored in Secrets Manager: apersona/asm/org/{orgId}
 *    - All tenants under the same org share this asmSecretKey
 *
 * 2. Tenant level:
 *    - Each tenant registers via newTenantAssignmentWithDefaults.ap
 *    - Uses the org's asmSecretKey + serviceProviderId
 *    - Returns asmClientId, mobileTokenKey, apiKeys, etc.
 *    - apiKeys are used to build amfaPolicies
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

const secretsManager = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

// Secret name patterns
const ORG_SECRET_PREFIX = "apersona/asm/org/";
const SHARED_SECRET_NAME = "apersona/asm/credentials";

/**
 * Get or create ASM Service Provider for an organization.
 *
 * Each org registers once with ASM portal. The returned serviceProviderId
 * and asmSecretKey are reused by all tenants under this org.
 *
 * @param {string} orgId - Organization ID
 * @param {string} contactEmail - Contact email for the org
 * @returns {Promise<Object>} { serviceProviderId, asmSecretKey, orgId }
 */
export async function getOrCreateServiceProvider(orgId, contactEmail) {
  console.log(`[ASM] Getting or creating Service Provider for org: ${orgId}`);

  const secretName = `${ORG_SECRET_PREFIX}${orgId}`;

  // Try to get existing org credentials
  try {
    const secret = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    );

    const data = JSON.parse(secret.SecretString);
    console.log(`[ASM] ✓ Found existing Service Provider for org ${orgId}`);
    console.log(`[ASM]   Service Provider ID: ${data.serviceProviderId}`);

    return {
      serviceProviderId: data.serviceProviderId,
      asmSecretKey: data.asmSecretKey,
      orgId: orgId,
    };
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw new Error(`Failed to retrieve org credentials: ${error.message}`);
    }
    console.log(
      `[ASM] No existing Service Provider for org ${orgId}, creating...`,
    );
  }

  // Create new Service Provider
  const asmPortalUrl = process.env.ASM_PORTAL_URL;
  const awsAccount = process.env.ACCOUNT_ID;
  const awsRegion = process.env.AWS_REGION;

  if (!asmPortalUrl) {
    throw new Error("ASM_PORTAL_URL environment variable is required");
  }

  const formData = new URLSearchParams({
    serviceProviderName: orgId,
    requestedBy: contactEmail,
    awsAccountId: awsAccount,
    awsRegion: awsRegion,
    email: contactEmail,
  });

  console.log(`[ASM] Creating Service Provider:`);
  console.log(`[ASM]   URL: ${asmPortalUrl}/createServiceProvider.ap`);
  console.log(`[ASM]   Org ID: ${orgId}`);
  console.log(`[ASM]   Contact: ${contactEmail}`);

  const response = await fetch(`${asmPortalUrl}/createServiceProvider.ap`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ASM createServiceProvider failed (${response.status}): ${errorText}`,
    );
  }

  const result = await response.json();

  if (
    result.code !== 200 ||
    !result.serviceProviderId ||
    !result.asmSecretKey
  ) {
    throw new Error(
      `ASM createServiceProvider returned invalid response: ${JSON.stringify(result)}`,
    );
  }

  console.log(`[ASM] ✓ Service Provider created`);
  console.log(`[ASM]   Service Provider ID: ${result.serviceProviderId}`);
  console.log(`[ASM]   Service Provider Name: ${result.serviceProviderName}`);

  const orgData = {
    serviceProviderId: String(result.serviceProviderId),
    asmSecretKey: result.asmSecretKey,
    serviceProviderName: result.serviceProviderName,
    orgId: orgId,
    contactEmail: contactEmail,
    createdAt: new Date().toISOString(),
  };

  // Store in Secrets Manager
  try {
    await secretsManager.send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: JSON.stringify(orgData),
        Description: `ASM Service Provider credentials for org: ${orgId}`,
        Tags: [
          { Key: "OrgId", Value: orgId },
          { Key: "CreatedBy", Value: "provision-tenant-lambda" },
          { Key: "Purpose", Value: "ASM-service-provider" },
        ],
      }),
    );
    console.log(`[ASM] ✓ Org credentials stored in ${secretName}`);
  } catch (storeError) {
    if (storeError.name === "ResourceExistsException") {
      console.log(`[ASM] Secret already exists (race condition), updating...`);
      await secretsManager.send(
        new PutSecretValueCommand({
          SecretId: secretName,
          SecretString: JSON.stringify(orgData),
        }),
      );
    } else {
      throw new Error(`Failed to store org credentials: ${storeError.message}`);
    }
  }

  return {
    serviceProviderId: String(result.serviceProviderId),
    asmSecretKey: result.asmSecretKey,
    orgId: orgId,
  };
}

/**
 * Register a new tenant with ASM portal.
 *
 * Uses the org's asmSecretKey and serviceProviderId.
 * Returns full ASM response including apiKeys (used for amfaPolicies).
 *
 * @param {Object} tenantData - Tenant data (tenantId, contactEmail, etc.)
 * @param {Object} orgCredentials - Org credentials from getOrCreateServiceProvider()
 * @returns {Promise<Object>} Full ASM registration response including apiKeys
 */
export async function registerTenantWithASM(tenantData, orgCredentials) {
  const { tenantId, contactEmail } = tenantData;
  const { serviceProviderId, asmSecretKey } = orgCredentials;

  const asmPortalUrl = process.env.ASM_PORTAL_URL;
  const awsAccount = process.env.ACCOUNT_ID;
  const awsRegion = process.env.AWS_REGION;
  const rootDomain = process.env.ROOT_DOMAIN_NAME;

  if (!asmPortalUrl) {
    throw new Error("ASM_PORTAL_URL environment variable is required");
  }

  const awsUserPoolFqdn = `${tenantId}.apersonaid.${rootDomain}`;

  const formData = new URLSearchParams({
    newTenantName: tenantId,
    newTenantAdminEmail: contactEmail,
    awsAccountId: awsAccount,
    asmSecretKey: asmSecretKey,
    serviceProviderId: serviceProviderId,
    awsUserPoolFqdn: awsUserPoolFqdn,
    awsRegion: awsRegion,
    asmTenantInstallerEmail: contactEmail,
  });

  console.log(`[ASM] Registering tenant with ASM:`);
  console.log(
    `[ASM]   URL: ${asmPortalUrl}/newTenantAssignmentWithDefaults.ap`,
  );
  console.log(`[ASM]   Tenant ID: ${tenantId}`);
  console.log(`[ASM]   Service Provider ID: ${serviceProviderId}`);
  console.log(`[ASM]   UserPool FQDN: ${awsUserPoolFqdn}`);

  const response = await fetch(
    `${asmPortalUrl}/newTenantAssignmentWithDefaults.ap`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ASM tenant registration failed (${response.status}): ${errorText}`,
    );
  }

  const result = await response.json();

  // Handle both direct response and wrapped response formats
  const asmData = result.registRes || result;

  if (!asmData.asmClientId || !asmData.mobileTokenKey) {
    throw new Error(
      `ASM tenant registration returned incomplete data: ${JSON.stringify(result)}`,
    );
  }

  console.log(`[ASM] ✓ Tenant registered with ASM`);
  console.log(`[ASM]   ASM Client ID: ${asmData.asmClientId}`);
  console.log(
    `[ASM]   API Keys: ${JSON.stringify(Object.keys(asmData.apiKeys || {}))}`,
  );

  // Store tenant ASM credentials in Secrets Manager for future reference
  const tenantSecretName = `apersona/asm/tenant/${tenantId}`;
  try {
    await secretsManager.send(
      new CreateSecretCommand({
        Name: tenantSecretName,
        SecretString: JSON.stringify({
          ...asmData,
          orgId: orgCredentials.orgId,
          serviceProviderId: serviceProviderId,
          registeredAt: new Date().toISOString(),
        }),
        Description: `ASM credentials for tenant: ${tenantId}`,
        Tags: [
          { Key: "TenantId", Value: tenantId },
          { Key: "OrgId", Value: orgCredentials.orgId },
          { Key: "CreatedBy", Value: "provision-tenant-lambda" },
        ],
      }),
    );
    console.log(`[ASM] ✓ Tenant credentials stored in ${tenantSecretName}`);
  } catch (storeError) {
    if (storeError.name === "ResourceExistsException") {
      console.log(`[ASM] Tenant secret already exists, updating...`);
      await secretsManager.send(
        new PutSecretValueCommand({
          SecretId: tenantSecretName,
          SecretString: JSON.stringify({
            ...asmData,
            orgId: orgCredentials.orgId,
            serviceProviderId: serviceProviderId,
            registeredAt: new Date().toISOString(),
          }),
        }),
      );
    } else {
      // Non-fatal: log warning but don't fail provisioning
      console.warn(
        `[ASM] Warning: Failed to store tenant credentials: ${storeError.message}`,
      );
    }
  }

  return {
    asmClientId: String(asmData.asmClientId),
    asmClientName: asmData.asmClientName,
    mobileTokenKey: asmData.mobileTokenKey,
    mobileTokenSalt: asmData.mobileTokenSalt,
    asmClientSecretKey: asmData.asmClientSecretKey,
    asmSecretKeyNew: asmData.asmSecretKeyNew,
    apiKeys: asmData.apiKeys || {},
    asmPortalUrl: asmPortalUrl,
    registeredAt: new Date().toISOString(),
  };
}

/**
 * Get shared ASM credentials from Secrets Manager (legacy/backward-compatible).
 *
 * This reads the global credentials stored by install.sh's register_asm_global().
 * Used as a fallback when org-level credentials are not available.
 *
 * @returns {Promise<Object>} Shared ASM credentials
 */
export async function getSharedASMCredentials() {
  console.log("[ASM] Getting shared ASM credentials (legacy)");

  try {
    const secret = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: SHARED_SECRET_NAME }),
    );

    const data = JSON.parse(secret.SecretString);
    const credentials = data.registRes || data;

    console.log("[ASM] ✓ Found shared credentials");
    console.log(`[ASM]   ASM Client ID: ${credentials.asmClientId}`);

    return {
      asmClientId: String(credentials.asmClientId),
      mobileTokenKey: credentials.mobileTokenKey,
      mobileTokenSalt: credentials.mobileTokenSalt,
      asmClientSecretKey: credentials.asmClientSecretKey,
      apiKeys: credentials.apiKeys || {},
      asmPortalUrl:
        credentials.asmPortalUrl || process.env.ASM_PORTAL_URL || "",
      registeredAt: credentials.registeredAt || new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      console.log("[ASM] No shared credentials found");
      return null;
    }
    throw new Error(
      `Failed to retrieve shared ASM credentials: ${error.message}`,
    );
  }
}

/**
 * Validate ASM credentials
 *
 * @param {Object} credentials - ASM credentials to validate
 * @returns {boolean} True if credentials are valid
 */
export function validateASMCredentials(credentials) {
  return (
    credentials &&
    typeof credentials.asmClientId === "string" &&
    typeof credentials.mobileTokenKey === "string" &&
    credentials.asmClientId.length > 0 &&
    credentials.mobileTokenKey.length > 0
  );
}

export default getSharedASMCredentials;
