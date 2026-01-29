/**
 * Shared ASM Registration Module
 * 
 * Manages shared ASM credentials for all tenants.
 * Instead of registering each tenant separately with ASM portal,
 * we create ONE shared registration that all tenants use.
 * 
 * Benefits:
 * - Fewer API calls to ASM portal
 * - Simpler credential management
 * - Consistent configuration across tenants
 */

import { 
  SecretsManagerClient, 
  GetSecretValueCommand,
  CreateSecretCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-secrets-manager';

const secretsManager = new SecretsManagerClient({ region: process.env.AWS_REGION });

// Shared secret name for all tenants
const SHARED_SECRET_NAME = 'apersona/shared/credentials';

/**
 * Get or create shared ASM credentials
 * This runs once and all tenants reuse these credentials
 * 
 * @returns {Promise<Object>} Shared ASM credentials
 */
export async function getSharedASMCredentials() {
  console.log('[ASM-Shared] Getting or creating shared ASM credentials');
  
  // Try to get existing shared credentials
  try {
    const secret = await secretsManager.send(
      new GetSecretValueCommand({
        SecretId: SHARED_SECRET_NAME
      })
    );
    
    const credentials = JSON.parse(secret.SecretString);
    console.log('[ASM-Shared] ✓ Found existing shared credentials');
    console.log(`[ASM-Shared]   ASM Client ID: ${credentials.asmClientId}`);
    
    return credentials;
    
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw new Error(`Failed to retrieve shared ASM credentials: ${error.message}`);
    }
    
    console.log('[ASM-Shared] No existing credentials found, creating new ones...');
  }
  
  // Create new shared credentials (first-time only)
  const asmData = await registerSharedASM();
  
  // Store in Secrets Manager for future use
  await storeSharedCredentials(asmData);
  
  console.log('[ASM-Shared] ✓ Created and stored new shared credentials');
  return asmData;
}

/**
 * Register a shared "master" tenant with ASM portal
 * This is done once for the entire system
 * 
 * @returns {Promise<Object>} ASM registration data
 */
async function registerSharedASM() {
  const asmPortalUrl = process.env.ASM_PORTAL_URL;
  const asmSecretKey = process.env.ASM_SECRET_KEY;
  const awsAccount = process.env.AWS_ACCOUNT;
  const awsRegion = process.env.AWS_REGION;
  const rootDomain = process.env.ROOT_DOMAIN;
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  
  if (!asmPortalUrl || !asmSecretKey) {
    throw new Error('ASM_PORTAL_URL and ASM_SECRET_KEY environment variables are required');
  }
  
  console.log('[ASM-Shared] Registering shared tenant with ASM portal');
  console.log(`[ASM-Shared]   Portal URL: ${asmPortalUrl}`);
  
  const formData = new URLSearchParams({
    newTenantName: 'AMFA-Shared-System',
    awsAccountId: awsAccount,
    newTenantAdminEmail: adminEmail,
    asmSecretKey: asmSecretKey,
    awsUserPoolFqdn: rootDomain,
    awsRegion: awsRegion,
    asmTenantInstallerEmail: adminEmail
  });
  
  const response = await fetch(
    `${asmPortalUrl}/newTenantAssignmentWithDefaults.ap`,
    {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    }
  );
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ASM portal registration failed (${response.status}): ${errorText}`
    );
  }
  
  const asmData = await response.json();
  
  // Validate response
  if (!asmData.asmClientId || !asmData.mobileTokenKey) {
    throw new Error('ASM portal returned incomplete registration data');
  }
  
  console.log('[ASM-Shared] ✓ Successfully registered with ASM portal');
  console.log(`[ASM-Shared]   ASM Client ID: ${asmData.asmClientId}`);
  
  return {
    asmClientId: asmData.asmClientId,
    mobileTokenKey: asmData.mobileTokenKey,
    asmPortalUrl: asmPortalUrl,
    registeredAt: new Date().toISOString()
  };
}

/**
 * Store shared credentials in Secrets Manager
 * 
 * @param {Object} asmData - ASM registration data
 * @returns {Promise<void>}
 */
async function storeSharedCredentials(asmData) {
  console.log('[ASM-Shared] Storing shared credentials in Secrets Manager');
  
  try {
    await secretsManager.send(
      new CreateSecretCommand({
        Name: SHARED_SECRET_NAME,
        SecretString: JSON.stringify(asmData),
        Description: 'Shared ASM credentials for all AMFA tenants',
        Tags: [
          { Key: 'Shared', Value: 'true' },
          { Key: 'CreatedBy', Value: 'provision-tenant-lambda' },
          { Key: 'Purpose', Value: 'ASM-credentials' }
        ]
      })
    );
    
    console.log(`[ASM-Shared] ✓ Stored credentials in ${SHARED_SECRET_NAME}`);
    
  } catch (error) {
    // If secret already exists (race condition), that's okay
    if (error.name === 'ResourceExistsException') {
      console.log('[ASM-Shared] Secret already exists (another Lambda created it)');
      // Try to get the existing secret
      const secret = await secretsManager.send(
        new GetSecretValueCommand({ SecretId: SHARED_SECRET_NAME })
      );
      return JSON.parse(secret.SecretString);
    }
    
    throw new Error(`Failed to store shared credentials: ${error.message}`);
  }
}

/**
 * Get shared ASM credentials from Secrets Manager
 * (Same as getSharedASMCredentials but only reads, doesn't create)
 * 
 * @returns {Promise<Object|null>} Shared ASM credentials or null if not found
 */
export async function getExistingSharedCredentials() {
  try {
    const secret = await secretsManager.send(
      new GetSecretValueCommand({
        SecretId: SHARED_SECRET_NAME
      })
    );
    
    return JSON.parse(secret.SecretString);
    
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return null;
    }
    throw error;
  }
}

/**
 * Validate shared ASM credentials
 * 
 * @param {Object} credentials - ASM credentials to validate
 * @returns {boolean} True if credentials are valid
 */
export function validateASMCredentials(credentials) {
  return (
    credentials &&
    typeof credentials.asmClientId === 'string' &&
    typeof credentials.mobileTokenKey === 'string' &&
    credentials.asmClientId.length > 0 &&
    credentials.mobileTokenKey.length > 0
  );
}

export default getSharedASMCredentials;
