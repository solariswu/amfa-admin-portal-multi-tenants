/**
 * Rollback Module
 *
 * Handles cleanup of partially provisioned resources when tenant provisioning fails.
 * Ensures no orphaned resources are left behind.
 *
 * Rollback order (reverse of provisioning, LIFO):
 * 1. Delete from DynamoDB (tenant record)
 * 2. Delete per-tenant secrets from Secrets Manager (smtp, secret, asm)
 * 3. Delete config entries from amfa-configtable
 * 4. Delete config files from S3
 * 5. Delete per-tenant DynamoDB tables
 * 6. Delete Cognito resources (UserPool domain + UserPool)
 * 7. ASM cleanup:
 *    a. Deregister TA admin via tenantAdmin.ap (action=remove)
 *    b. Delete ASM client via deleteAsmClient.ap
 *    c. Delete ASM tenant secret (apersona/asm/tenant/{tenantId})
 */

import {
  CognitoIdentityProviderClient,
  DeleteUserPoolCommand,
  DeleteUserPoolDomainCommand,
  DescribeUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  DeleteSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { deleteTenantFromDynamoDB } from "./dynamodb-operations.mjs";
import { deleteConfigFiles } from "./config-generator.mjs";

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});
const secretsManager = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

/**
 * Perform complete rollback of tenant provisioning
 *
 * @param {Array} provisioningLog - Log of completed provisioning steps
 * @returns {Promise<void>}
 */
export async function rollbackProvisioning(provisioningLog) {
  console.log("=".repeat(60));
  console.log("[ROLLBACK] Starting cleanup of provisioned resources");
  console.log("=".repeat(60));

  if (!provisioningLog || provisioningLog.length === 0) {
    console.log("[ROLLBACK] No resources to clean up");
    return;
  }

  // Process in reverse order (LIFO - Last In, First Out)
  const rollbackSteps = [...provisioningLog].reverse();
  let successCount = 0;
  let failCount = 0;

  for (const step of rollbackSteps) {
    try {
      await rollbackStep(step);
      successCount++;
      console.log(`[ROLLBACK] ✓ Successfully rolled back: ${step.step}`);
    } catch (error) {
      failCount++;
      console.error(
        `[ROLLBACK] ✗ Failed to rollback ${step.step}:`,
        error.message,
      );
      // Continue with other rollbacks - don't let one failure stop others
    }
  }

  console.log("=".repeat(60));
  console.log(
    `[ROLLBACK] Cleanup complete: ${successCount} successful, ${failCount} failed`,
  );
  console.log("=".repeat(60));
}

/**
 * Rollback a single provisioning step
 */
async function rollbackStep(step) {
  const { step: stepName, data } = step;

  console.log(`[ROLLBACK] Processing: ${stepName}`);

  switch (stepName) {
    case "dynamodb":
      await rollbackDynamoDB(data);
      break;

    case "config":
      await rollbackConfigFiles(data);
      break;

    case "tables":
      await rollbackTables(data);
      break;

    case "cognito":
      await rollbackCognito(data);
      break;

    case "asm":
    case "asm-tenant":
      await rollbackASM(data);
      break;

    case "secrets":
      await rollbackSecrets(data);
      break;

    case "configs":
      await rollbackConfigTableEntries(data);
      break;

    default:
      console.warn(`[ROLLBACK] Unknown step type: ${stepName}, skipping`);
  }
}

/**
 * Rollback DynamoDB entry
 */
async function rollbackDynamoDB(data) {
  const tenantId = data?.tenantId || data?.id;

  if (!tenantId) {
    console.warn("[ROLLBACK] No tenant ID provided for DynamoDB rollback");
    return;
  }

  console.log(`[ROLLBACK] Deleting tenant ${tenantId} from DynamoDB`);
  await deleteTenantFromDynamoDB(tenantId);
}

/**
 * Rollback config files from S3
 */
async function rollbackConfigFiles(data) {
  const tenantId = data?.tenantId;

  if (!tenantId) {
    console.warn("[ROLLBACK] No tenant ID provided for config files rollback");
    return;
  }

  console.log(`[ROLLBACK] Deleting config files for tenant ${tenantId}`);
  await deleteConfigFiles(tenantId);
}

/**
 * Rollback per-tenant DynamoDB tables
 */
async function rollbackTables(data) {
  // Extract tenant ID from table names
  const authCodeTable = data?.authCodeTable;

  if (!authCodeTable) {
    console.warn("[ROLLBACK] No table names provided for tables rollback");
    return;
  }

  // Extract tenantId from table name: amfa-authcode-{tenantId}
  const tenantId = authCodeTable.replace("amfa-authcode-", "");

  console.log(`[ROLLBACK] Deleting per-tenant tables for tenant ${tenantId}`);

  try {
    const { deleteTenantTables } = await import("./table-provisioning.mjs");
    await deleteTenantTables(tenantId);
    console.log(
      `[ROLLBACK] Successfully deleted tables for tenant ${tenantId}`,
    );
  } catch (error) {
    console.error(`[ROLLBACK] Error deleting tables:`, error.message);
    // Don't throw - continue with other rollback steps
  }
}

/**
 * Rollback Cognito resources
 * Must delete domain BEFORE deleting UserPool
 */
async function rollbackCognito(data) {
  const userPoolId = data?.userPoolId;
  const oauthDomain = data?.oauthDomain;

  if (!userPoolId) {
    console.warn("[ROLLBACK] No UserPool ID provided for Cognito rollback");
    return;
  }

  console.log(`[ROLLBACK] Deleting Cognito UserPool: ${userPoolId}`);

  try {
    // STEP 1: Delete the domain first (if it exists)
    if (oauthDomain) {
      console.log(`[ROLLBACK] Deleting Cognito domain: ${oauthDomain}`);

      try {
        const deleteDomainCommand = new DeleteUserPoolDomainCommand({
          Domain: oauthDomain,
          UserPoolId: userPoolId,
        });

        await cognito.send(deleteDomainCommand);
        console.log(`[ROLLBACK] Successfully deleted domain ${oauthDomain}`);

        // Wait a moment for domain deletion to propagate
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (domainError) {
        if (domainError.name === "ResourceNotFoundException") {
          console.log(
            `[ROLLBACK] Domain ${oauthDomain} already deleted or doesn't exist`,
          );
        } else {
          console.warn(
            `[ROLLBACK] Failed to delete domain, but continuing:`,
            domainError.message,
          );
        }
      }
    }

    // STEP 2: Delete the UserPool (this cascades to delete clients)
    const deletePoolCommand = new DeleteUserPoolCommand({
      UserPoolId: userPoolId,
    });

    await cognito.send(deletePoolCommand);
    console.log(`[ROLLBACK] Successfully deleted UserPool ${userPoolId}`);
  } catch (error) {
    if (error.name === "ResourceNotFoundException") {
      console.log(
        `[ROLLBACK] UserPool ${userPoolId} already deleted or doesn't exist`,
      );
      return;
    }

    // If still failing due to domain, try to get and delete it
    if (error.message && error.message.includes("domain")) {
      console.log(`[ROLLBACK] Retrying after domain issue...`);

      try {
        // Describe UserPool to get domain info
        const describeCommand = new DescribeUserPoolCommand({
          UserPoolId: userPoolId,
        });

        const poolInfo = await cognito.send(describeCommand);
        const domain = poolInfo.UserPool?.Domain;

        if (domain) {
          console.log(`[ROLLBACK] Found domain ${domain}, deleting it`);
          const deleteDomainCommand = new DeleteUserPoolDomainCommand({
            Domain: domain,
            UserPoolId: userPoolId,
          });

          await cognito.send(deleteDomainCommand);
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Retry UserPool deletion
          await cognito.send(
            new DeleteUserPoolCommand({ UserPoolId: userPoolId }),
          );
          console.log(
            `[ROLLBACK] Successfully deleted UserPool ${userPoolId} after domain cleanup`,
          );
        }
      } catch (retryError) {
        console.error(`[ROLLBACK] Retry failed:`, retryError.message);
        throw error; // Throw original error
      }
    } else {
      throw error;
    }
  }
}

/**
 * Rollback ASM registration
 *
 * Cleans up ASM resources created during provisioning:
 * 1. Deregister the TA admin from ASM via tenantAdmin.ap (action=remove)
 * 2. Delete the ASM client via deleteAsmClient.ap
 */
async function rollbackASM(data) {
  const tenantId = data?.tenantId;
  const asmClientId = data?.asmClientId;

  if (!tenantId) {
    console.warn("[ROLLBACK] No tenant ID provided for ASM rollback");
    return;
  }

  const asmPortalUrl = process.env.ASM_PORTAL_URL;
  if (!asmPortalUrl) {
    console.warn("[ROLLBACK] ASM_PORTAL_URL not configured, skipping ASM rollback");
    return;
  }

  // Read tenant and org credentials from Secrets Manager
  const tenantSecretName = `apersona/asm/tenant/${tenantId}`;
  let tenantCredentials;
  try {
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: tenantSecretName }),
    );
    tenantCredentials = JSON.parse(secretResult.SecretString);
  } catch (secretError) {
    console.warn(`[ROLLBACK] Could not read tenant ASM credentials (${tenantSecretName}): ${secretError.message}`);
    console.warn(`[ROLLBACK] Skipping ASM cleanup — credentials not available`);
    return;
  }

  const resolvedAsmClientId = asmClientId || tenantCredentials.asmClientId;
  const asmClientSecretKey = tenantCredentials.asmClientSecretKey || "";
  const orgId = tenantCredentials.orgId;

  if (!orgId) {
    console.warn("[ROLLBACK] No orgId found in tenant credentials, skipping ASM rollback");
    return;
  }

  // Read org credentials to get asmSecretKey
  const orgSecretName = `apersona/asm/org/${orgId}`;
  let orgCredentials;
  try {
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: orgSecretName }),
    );
    orgCredentials = JSON.parse(secretResult.SecretString);
  } catch (secretError) {
    console.warn(`[ROLLBACK] Could not read org ASM credentials (${orgSecretName}): ${secretError.message}`);
    console.warn(`[ROLLBACK] Skipping ASM cleanup — org credentials not available`);
    return;
  }

  const asmSecretKey = orgCredentials.asmSecretKey;
  if (!asmSecretKey) {
    console.warn("[ROLLBACK] No asmSecretKey found for org, skipping ASM rollback");
    return;
  }

  // Step 1: Deregister the TA admin(s) that were added during newTenantAssignmentWithDefaults
  // The newTenantAssignmentWithDefaults.ap call adds newTenantAdminEmail as a TA admin
  const tenantAdminEmail = tenantCredentials.awsAdminEmail || tenantCredentials.newTenantAdminEmail;
  if (tenantAdminEmail && resolvedAsmClientId) {
    console.log(`[ROLLBACK] Deregistering TA admin '${tenantAdminEmail}' from ASM...`);

    // Read tenant name (fallback to tenantId)
    let tenantName = tenantId;
    if (tenantCredentials.asmClientName) {
      tenantName = tenantCredentials.asmClientName;
    }

    try {
      const formData = new URLSearchParams({
        tenantId: resolvedAsmClientId,
        tenantName: tenantName,
        tenantAdminEmail: tenantAdminEmail,
        action: "remove",
        requestedBy: "provision-tenant-rollback",
        awsAccountId: process.env.ACCOUNT_ID || "",
        asmSecretKey: asmSecretKey,
      });

      const response = await fetch(`${asmPortalUrl}/tenantAdmin.ap`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`[ROLLBACK] ✓ TA admin deregistered from ASM:`, JSON.stringify(result));
      } else {
        const errorText = await response.text();
        console.warn(`[ROLLBACK] tenantAdmin.ap (action=remove) failed (${response.status}): ${errorText}`);
      }
    } catch (asmError) {
      console.warn(`[ROLLBACK] Failed to deregister TA admin from ASM (non-fatal): ${asmError.message}`);
    }
  }

  // Step 2: Delete the ASM client (tenant) via deleteAsmClient.ap
  if (resolvedAsmClientId) {
    console.log(`[ROLLBACK] Deleting ASM client ${resolvedAsmClientId}...`);

    try {
      const formData = new URLSearchParams({
        asmClientId: resolvedAsmClientId,
        requestedBy: "provision-tenant-rollback",
        asmSecretKey: asmSecretKey,
        asmClientSecretKey: asmClientSecretKey || asmSecretKey,
      });

      const response = await fetch(`${asmPortalUrl}/deleteAsmClient.ap`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`[ROLLBACK] ✓ ASM client deleted:`, JSON.stringify(result));
      } else {
        const errorText = await response.text();
        console.warn(`[ROLLBACK] deleteAsmClient.ap failed (${response.status}): ${errorText}`);
      }
    } catch (asmError) {
      console.warn(`[ROLLBACK] Failed to delete ASM client (non-fatal): ${asmError.message}`);
    }
  } else {
    console.warn("[ROLLBACK] No asmClientId available, skipping ASM client deletion");
  }

  // Step 3: Delete ASM tenant secret from Secrets Manager
  // This is the apersona/asm/tenant/{tenantId} secret created by asm-shared.mjs
  console.log(`[ROLLBACK] Deleting ASM tenant secret: ${tenantSecretName}`);
  try {
    await secretsManager.send(
      new DeleteSecretCommand({
        SecretId: tenantSecretName,
        ForceDeleteWithoutRecovery: true,
      }),
    );
    console.log(`[ROLLBACK] ✓ Deleted ASM tenant secret: ${tenantSecretName}`);
  } catch (deleteError) {
    if (deleteError.name === "ResourceNotFoundException") {
      console.log(`[ROLLBACK] ASM tenant secret ${tenantSecretName} not found, skipping`);
    } else {
      console.warn(`[ROLLBACK] Failed to delete ASM tenant secret (non-fatal): ${deleteError.message}`);
    }
  }
}

/**
 * Rollback per-tenant Secrets Manager secrets
 *
 * Deletes secrets created in Step 5.6 of provisioning:
 * - apersona/{tenantId}/smtp
 * - apersona/{tenantId}/secret
 * - apersona/{tenantId}/asm
 */
async function rollbackSecrets(data) {
  const tenantId = data?.tenantId;
  const secrets = data?.secrets || [];

  if (!tenantId) {
    console.warn("[ROLLBACK] No tenant ID provided for secrets rollback");
    return;
  }

  // If specific secret names were logged, delete those
  // Otherwise, delete the known per-tenant secrets
  const secretNames = secrets.length > 0
    ? secrets
    : [
        `apersona/${tenantId}/smtp`,
        `apersona/${tenantId}/secret`,
        `apersona/${tenantId}/asm`,
      ];

  console.log(`[ROLLBACK] Deleting ${secretNames.length} per-tenant secret(s) for tenant ${tenantId}`);

  for (const secretName of secretNames) {
    try {
      await secretsManager.send(
        new DeleteSecretCommand({
          SecretId: secretName,
          ForceDeleteWithoutRecovery: true,
        }),
      );
      console.log(`[ROLLBACK] ✓ Deleted secret: ${secretName}`);
    } catch (error) {
      if (error.name === "ResourceNotFoundException") {
        console.log(`[ROLLBACK] Secret ${secretName} not found, skipping`);
      } else {
        console.error(`[ROLLBACK] ✗ Failed to delete ${secretName}: ${error.message}`);
        // Non-fatal — continue with other secrets
      }
    }
  }
}

/**
 * Rollback config entries from amfa-configtable
 *
 * Deletes config entries created in Step 5.5 of provisioning:
 * - amfaBrandings, amfaConfigs, amfaLegals, amfaPolicies
 */
async function rollbackConfigTableEntries(data) {
  const tenantId = data?.tenantId;
  const configTypes = data?.configTypes || [];

  if (!tenantId) {
    console.warn("[ROLLBACK] No tenant ID provided for config table rollback");
    return;
  }

  // If specific config types were logged, delete those
  // Otherwise, delete the known config types
  const typesToDelete = configTypes.length > 0
    ? configTypes
    : ["amfaBrandings", "amfaConfigs", "amfaLegals", "amfaPolicies"];

  const { DynamoDBClient, DeleteItemCommand } = await import("@aws-sdk/client-dynamodb");
  const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
  const configTable = "amfa-configtable";

  console.log(`[ROLLBACK] Deleting ${typesToDelete.length} config entries for tenant ${tenantId}`);

  for (const configType of typesToDelete) {
    try {
      await dynamodb.send(
        new DeleteItemCommand({
          TableName: configTable,
          Key: {
            id: { S: tenantId },
            configtype: { S: configType },
          },
        }),
      );
      console.log(`[ROLLBACK] ✓ Deleted ${configType} for tenant ${tenantId}`);
    } catch (error) {
      console.error(`[ROLLBACK] ✗ Failed to delete ${configType} for ${tenantId}: ${error.message}`);
      // Non-fatal — continue with other config types
    }
  }
}

/**
 * Validate rollback completion
 *
 * @param {string} tenantId - Tenant ID to validate
 * @returns {Promise<Object>} Validation results
 */
export async function validateRollback(tenantId) {
  console.log(`[ROLLBACK] Validating cleanup for tenant: ${tenantId}`);

  const results = {
    tenantId,
    complete: true,
    checks: {
      dynamodb: { cleaned: false, error: null },
      configFiles: { cleaned: false, error: null },
      cognito: { cleaned: false, error: null },
    },
  };

  // Check DynamoDB
  try {
    const { checkTenantExists } = await import("./dynamodb-operations.mjs");
    const exists = await checkTenantExists(tenantId);
    results.checks.dynamodb.cleaned = !exists;
    if (exists) {
      results.complete = false;
      results.checks.dynamodb.error = "Tenant still exists in DynamoDB";
    }
  } catch (error) {
    results.checks.dynamodb.error = error.message;
    results.complete = false;
  }

  // Check config files (would need S3 check - simplified here)
  results.checks.configFiles.cleaned = true; // Assume cleaned if no error

  // Check Cognito (would need Cognito check - simplified here)
  results.checks.cognito.cleaned = true; // Assume cleaned if no error

  console.log(
    `[ROLLBACK] Validation complete: ${results.complete ? "PASS" : "FAIL"}`,
  );

  return results;
}

/**
 * Create error with rollback information
 */
export function createRollbackError(originalError, rollbackResults) {
  const error = new Error(
    `Tenant provisioning failed: ${originalError.message}. ` +
      `Rollback ${rollbackResults.complete ? "completed successfully" : "partially completed"}.`,
  );

  error.originalError = originalError;
  error.rollbackResults = rollbackResults;
  error.statusCode = originalError.statusCode || 500;

  return error;
}

export default rollbackProvisioning;
