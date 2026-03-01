/**
 * ASM (APersona) Registration Module
 *
 * ⚠️ DEPRECATED - This module is no longer used ⚠️
 *
 * The system now uses SHARED ASM credentials for all tenants.
 * See: asm-shared.mjs
 *
 * This file is kept for backward compatibility and reference only.
 *
 * Previous behavior: Each tenant registered separately with ASM portal
 * New behavior: All tenants share ONE set of ASM credentials
 *
 * Migration date: Phase 4 implementation
 * Can be removed after: All tenants migrated to shared credentials
 *
 * ---
 *
 * Old documentation:
 * Handles registration with the ASM portal for mobile token authentication.
 * This module manages the lifecycle of ASM credentials for each tenant.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
} from "@aws-sdk/client-secretsmanager";

const secretsManager = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

/**
 * Register tenant with ASM portal or reuse existing registration
 *
 * @param {Object} tenantData - Validated tenant data
 * @returns {Object} ASM registration data (asmClientId, mobileTokenKey, etc.)
 */
export async function registerOrReuseTenant(tenantData) {
  const { tenantId, tenantName } = tenantData;

  console.log(`[ASM] Checking registration for tenant: ${tenantId}`);

  // 1. Check if already registered (reuse existing)
  try {
    const existingSecret = await secretsManager.send(
      new GetSecretValueCommand({
        SecretId: `apersona/${tenantId}/install`,
      }),
    );

    const secretData = JSON.parse(existingSecret.SecretString);
    console.log(
      `[ASM] Tenant ${tenantId} already registered, reusing existing data`,
    );

    // Validate that we have the required fields
    if (
      !secretData.registRes?.asmClientId ||
      !secretData.registRes?.mobileTokenKey
    ) {
      console.warn(
        `[ASM] Existing secret missing required fields, re-registering`,
      );
      // Fall through to registration
    } else {
      return secretData.registRes;
    }
  } catch (error) {
    if (error.name !== "ResourceNotFoundException") {
      console.error(`[ASM] Error checking existing registration:`, error);
      throw error;
    }
    console.log(`[ASM] No existing registration found for ${tenantId}`);
  }

  // 2. Perform new registration with ASM portal
  console.log(`[ASM] Registering new tenant ${tenantId} with ASM portal`);

  const asmPortalUrl = process.env.ASM_PORTAL_URL;
  const asmSecretKey = process.env.ASM_SECRET_KEY;

  if (!asmPortalUrl || !asmSecretKey) {
    throw new Error(
      "ASM_PORTAL_URL and ASM_SECRET_KEY environment variables are required",
    );
  }

  // Prepare form data for ASM API
  const formData = new URLSearchParams({
    newTenantName: encodeURIComponent(tenantName),
    awsAccountId: process.env.ACCOUNT_ID,
    newTenantAdminEmail: process.env.ADMIN_EMAIL,
    asmSecretKey: asmSecretKey,
    awsUserPoolFqdn: process.env.ROOT_DOMAIN_NAME,
    awsRegion: process.env.AWS_REGION,
    asmTenantInstallerEmail:
      process.env.INSTALLER_EMAIL || process.env.ADMIN_EMAIL,
  });

  console.log(
    `[ASM] Calling ASM API: ${asmPortalUrl}/newTenantAssignmentWithDefaults.ap`,
  );

  // Call ASM portal API with retry logic
  let registrationResult;
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount < maxRetries) {
    try {
      const response = await fetch(
        `${asmPortalUrl}/newTenantAssignmentWithDefaults.ap`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
          timeout: 30000, // 30 second timeout
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ASM API returned ${response.status}: ${errorText}`);
      }

      registrationResult = await response.json();
      console.log(`[ASM] Registration successful for ${tenantId}`);
      break;
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) {
        console.error(
          `[ASM] Registration failed after ${maxRetries} attempts:`,
          error,
        );
        throw new Error(`Failed to register with ASM portal: ${error.message}`);
      }

      console.warn(
        `[ASM] Registration attempt ${retryCount} failed, retrying...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000 * retryCount)); // Exponential backoff
    }
  }

  // 3. Validate ASM response
  if (!registrationResult.asmClientId) {
    throw new Error("ASM registration response missing asmClientId");
  }

  if (!registrationResult.mobileTokenKey) {
    throw new Error("ASM registration response missing mobileTokenKey");
  }

  if (!registrationResult.mobileTokenSalt) {
    throw new Error("ASM registration response missing mobileTokenSalt");
  }

  console.log(`[ASM] Registration data validated for ${tenantId}`);

  // 4. Store registration in Secrets Manager
  try {
    const secretString = JSON.stringify({
      registRes: registrationResult,
      timestamp: new Date().toISOString(),
      tenantId: tenantId,
    });

    await secretsManager.send(
      new CreateSecretCommand({
        Name: `apersona/${tenantId}/install`,
        SecretString: secretString,
        Description: `ASM registration data for tenant ${tenantId}`,
        Tags: [
          { Key: "TenantId", Value: tenantId },
          { Key: "CreatedBy", Value: "provision-tenant-lambda" },
        ],
      }),
    );

    console.log(
      `[ASM] Registration data saved to Secrets Manager for ${tenantId}`,
    );
  } catch (error) {
    console.error(
      `[ASM] Failed to save registration to Secrets Manager:`,
      error,
    );
    // Don't fail the provisioning if secret storage fails - we have the data
    console.warn(
      `[ASM] Continuing without storing secret (data will be in response)`,
    );
  }

  return registrationResult;
}

/**
 * Get ASM data for existing tenant
 */
export async function getASMData(tenantId) {
  try {
    const secret = await secretsManager.send(
      new GetSecretValueCommand({
        SecretId: `apersona/${tenantId}/install`,
      }),
    );

    const secretData = JSON.parse(secret.SecretString);
    return secretData.registRes;
  } catch (error) {
    console.error(`[ASM] Failed to retrieve ASM data for ${tenantId}:`, error);
    throw new Error(`ASM data not found for tenant ${tenantId}`);
  }
}

export default registerOrReuseTenant;
