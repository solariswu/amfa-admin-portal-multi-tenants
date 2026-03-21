/**
 * Tenant Provisioning Lambda - Main Orchestrator
 *
 * Handles complete tenant provisioning with transaction-like behavior:
 * 1. Validate input data
 * 2. Register with ASM portal (or reuse existing)
 * 3. Provision Cognito resources (UserPool, clients)
 * 3.5. Create per-tenant DynamoDB tables
 * 4. Generate and upload configuration files
 * 5. Save tenant to DynamoDB
 * 6. Return success OR rollback all changes on failure
 *
 * This Lambda is invoked by the Admin Portal API when creating a new tenant.
 */

import { validateTenantData } from "./validation.mjs";
import {
  getOrCreateServiceProvider,
  registerTenantWithASM,
} from "./asm-shared.mjs";
import { provisionCognitoResources } from "./cognito-provisioning.mjs";
import { createTenantTables } from "./table-provisioning.mjs";
import { generateAndUploadConfigs } from "./config-generator.mjs";
import {
  saveTenantToDynamoDB,
  checkTenantExists,
} from "./dynamodb-operations.mjs";
import {
  rollbackProvisioning,
  validateRollback,
  createRollbackError,
} from "./rollback.mjs";
import { buildTenantConfigs, DEFAULT_SMTP_CONFIG } from "./config-defaults.mjs";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import {
  SecretsManagerClient,
  CreateSecretCommand,
} from "@aws-sdk/client-secrets-manager";

const configDynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const secretsManagerClient = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

/**
 * Lambda handler for tenant provisioning
 *
 * @param {Object} event - Lambda event (API Gateway format)
 * @returns {Object} API Gateway response
 */
export const handler = async (event) => {
  console.log("=".repeat(80));
  console.log("[PROVISION] Tenant Provisioning Lambda started");
  console.log("[PROVISION] Event:", JSON.stringify(event, null, 2));
  console.log("=".repeat(80));

  const startTime = Date.now();
  const provisioningLog = [];
  let tenantData;

  try {
    // ========================================
    // STEP 1: Validate Input
    // ========================================
    console.log("\n[STEP 1/6] Validating input data...");
    tenantData = validateTenantData(event);
    console.log(
      `[STEP 1/6] ✓ Validation passed for tenant: ${tenantData.tenantId}`,
    );

    // ========================================
    // STEP 1.5: Check tenant doesn't exist
    // ========================================
    console.log("\n[STEP 1.5/6] Checking tenant uniqueness...");
    const exists = await checkTenantExists(tenantData.tenantId);
    if (exists) {
      throw Object.assign(
        new Error(`Tenant with ID '${tenantData.tenantId}' already exists`),
        { statusCode: 409 }, // Conflict
      );
    }
    console.log("[STEP 1.5/6] ✓ Tenant ID is unique");

    // ========================================
    // STEP 2a: Get or Create ASM Service Provider (per org)
    // ========================================
    console.log(
      "\n[STEP 2a/7] Getting or creating ASM Service Provider for org...",
    );
    const orgCredentials = await getOrCreateServiceProvider(
      tenantData.orgId,
      tenantData.contactEmail,
    );
    console.log("[STEP 2a/7] ✓ ASM Service Provider ready");
    console.log(`[STEP 2a/7]   Org ID: ${orgCredentials.orgId}`);
    console.log(
      `[STEP 2a/7]   Service Provider ID: ${orgCredentials.serviceProviderId}`,
    );

    // ========================================
    // STEP 2b: Register Tenant with ASM (per tenant)
    // ========================================
    console.log("\n[STEP 2b/7] Registering tenant with ASM portal...");
    const asmData = await registerTenantWithASM(tenantData, orgCredentials);
    provisioningLog.push({
      step: "asm-tenant",
      data: { tenantId: tenantData.tenantId, asmClientId: asmData.asmClientId },
    });
    console.log("[STEP 2b/7] ✓ Tenant registered with ASM");
    console.log(`[STEP 2b/7]   ASM Client ID: ${asmData.asmClientId}`);
    console.log(
      `[STEP 2b/7]   API Keys: ${Object.keys(asmData.apiKeys || {}).join(", ")}`,
    );

    // ========================================
    // STEP 3: Cognito Provisioning
    // ========================================
    console.log("\n[STEP 3/6] Provisioning Cognito resources...");
    const cognitoResources = await provisionCognitoResources(
      tenantData,
      asmData,
    );
    provisioningLog.push({
      step: "cognito",
      data: cognitoResources,
    });
    console.log("[STEP 3/6] ✓ Cognito resources created");
    console.log(`[STEP 3/6]   UserPool ID: ${cognitoResources.userPoolId}`);
    console.log(
      `[STEP 3/6]   SP Portal Client ID: ${cognitoResources.spPortalClientId}`,
    );

    // ========================================
    // STEP 4: Generate Config Files
    // ========================================
    console.log("\n[STEP 4/6] Generating and uploading configuration files...");
    const configUrls = await generateAndUploadConfigs(
      tenantData,
      cognitoResources,
    );
    provisioningLog.push({
      step: "config",
      data: { ...configUrls, tenantId: tenantData.tenantId },
    });
    console.log("[STEP 4/6] ✓ Configuration files uploaded");
    console.log(`[STEP 4/6]   AWS Config: ${configUrls.awsConfig}`);
    console.log(`[STEP 4/6]   Branding: ${configUrls.branding}`);

    // ========================================
    // STEP 5: Save to DynamoDB (with PROVISIONING status)
    // ========================================
    console.log("\n[STEP 5/6] Saving tenant to DynamoDB...");
    await saveTenantToDynamoDB(
      tenantData,
      cognitoResources,
      asmData,
      "provisioning",
    );
    provisioningLog.push({
      step: "dynamodb",
      data: { tenantId: tenantData.tenantId },
    });
    console.log(
      "[STEP 5/6] ✓ Tenant saved to database with status: provisioning",
    );

    // ========================================
    // STEP 5.5: Write default configs to amfa-configtable
    // ========================================
    console.log(
      "\n[STEP 5.5/7] Writing default configs to amfa-configtable...",
    );
    try {
      const configItems = buildTenantConfigs(
        tenantData.tenantId,
        tenantData.tenantName,
        asmData,
      );
      const configTableName = "amfa-configtable";

      for (const config of configItems) {
        await configDynamodb.send(
          new PutItemCommand({
            TableName: configTableName,
            Item: {
              id: { S: tenantData.tenantId },
              configtype: { S: config.configtype },
              value: { S: JSON.stringify(config.value) },
            },
            ConditionExpression:
              "attribute_not_exists(id) AND attribute_not_exists(configtype)", // Don't overwrite existing
          }),
        );
        console.log(`[STEP 5.5/7]   ✓ ${config.configtype} written`);
      }

      provisioningLog.push({
        step: "configs",
        data: {
          tenantId: tenantData.tenantId,
          configTypes: configItems.map((c) => c.configtype),
        },
      });
      console.log("[STEP 5.5/7] ✓ Default configs written to amfa-configtable");
    } catch (configError) {
      if (configError.name === "ConditionalCheckFailedException") {
        console.log(
          "[STEP 5.5/7] ⚠ Some configs already exist, skipping (not overwriting)",
        );
      } else {
        console.error(
          "[STEP 5.5/7] ✗ Failed to write configs:",
          configError.message,
        );
        // Non-fatal - continue with provisioning
      }
    }

    // ========================================
    // STEP 5.6: Create Per-Tenant Secrets in Secrets Manager
    // ========================================
    console.log(
      "\n[STEP 5.6/7] Creating per-tenant secrets in Secrets Manager...",
    );
    try {
      const tenantSecrets = [
        {
          name: `apersona/${tenantData.tenantId}/smtp`,
          value: DEFAULT_SMTP_CONFIG,
          description: `SMTP configuration for tenant ${tenantData.tenantId}`,
        },
        {
          name: `apersona/${tenantData.tenantId}/secret`,
          value: {
            Mobile_Token_Key: asmData.mobileTokenKey || "",
            Mobile_Token_Salt: asmData.mobileTokenSalt || "",
            Provider_Id: asmData.asmClientId || "",
            asmSalt: "", // Will be set later if needed
          },
          description: `Mobile token and ASM secrets for tenant ${tenantData.tenantId}`,
        },
        {
          name: `apersona/${tenantData.tenantId}/asm`,
          value: {
            tenantAuthToken: asmData.asmClientSecretKey || "",
          },
          description: `ASM auth token for tenant ${tenantData.tenantId}`,
        },
      ];

      for (const secret of tenantSecrets) {
        try {
          await secretsManagerClient.send(
            new CreateSecretCommand({
              Name: secret.name,
              SecretString: JSON.stringify(secret.value),
              Description: secret.description,
              Tags: [
                { Key: "TenantId", Value: tenantData.tenantId },
                { Key: "CreatedBy", Value: "provision-tenant-lambda" },
              ],
            }),
          );
          console.log(`[STEP 5.6/7]   ✓ ${secret.name} created`);
        } catch (secretError) {
          if (secretError.name === "ResourceExistsException") {
            console.log(
              `[STEP 5.6/7]   ⚠ ${secret.name} already exists, skipping`,
            );
          } else {
            throw secretError;
          }
        }
      }

      provisioningLog.push({
        step: "secrets",
        data: {
          tenantId: tenantData.tenantId,
          secrets: tenantSecrets.map((s) => s.name),
        },
      });
      console.log("[STEP 5.6/7] ✓ Per-tenant secrets created");
    } catch (secretsError) {
      console.error(
        "[STEP 5.6/7] ✗ Failed to create secrets:",
        secretsError.message,
      );
      // Non-fatal - continue with provisioning
    }

    // ========================================
    // STEP 6: Create Per-Tenant Tables (FINAL STEP)
    // ========================================
    console.log("\n[STEP 6/6] Creating per-tenant DynamoDB tables...");
    let tenantTables;
    let finalStatus = "active";

    try {
      tenantTables = await createTenantTables(tenantData.tenantId);
      console.log("[STEP 6/6] ✓ Per-tenant tables created");
      console.log(`[STEP 6/6]   AuthCode: ${tenantTables.authCodeTable}`);
      console.log(`[STEP 6/6]   SessionId: ${tenantTables.sessionIdTable}`);
      console.log(`[STEP 6/6]   TotpToken: ${tenantTables.totpTokenTable}`);
      console.log(`[STEP 6/6]   PwdHash: ${tenantTables.pwdHashTable}`);
      console.log(`[STEP 6/6]   SPInfo: ${tenantTables.spInfoTable}`);
      console.log(`[STEP 6/6]   ImportJob: ${tenantTables.importJobTable}`);

      // Update tenant status to ACTIVE
      const { updateTenantStatus } = await import("./dynamodb-operations.mjs");
      // Table names are no longer stored in DynamoDB - they follow a fixed convention: amfa-{type}-{tenantId}
      await updateTenantStatus(tenantData.tenantId, "active", {
        activatedAt: new Date().toISOString(),
      });
      console.log("[STEP 6/6] ✓ Tenant status updated to ACTIVE");
    } catch (tableError) {
      // Table creation failed - update status to tables_pending
      console.error("[STEP 6/6] ✗ Table creation failed:", tableError.message);
      finalStatus = "tables_pending";

      const { updateTenantStatus } = await import("./dynamodb-operations.mjs");
      await updateTenantStatus(tenantData.tenantId, "tables_pending", {
        tableCreationError: tableError.message,
        tableCreationFailedAt: new Date().toISOString(),
        tableCreationAttempts: 1,
      });

      console.log("[STEP 6/6] ⚠ Tenant saved with status: tables_pending");
      console.log(
        "[STEP 6/6] ⚠ Tenant can be activated later by retrying table creation",
      );

      // Don't throw - return partial success response
      const duration = Date.now() - startTime;
      return {
        statusCode: 207, // Multi-Status (partial success)
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          success: false,
          status: "tables_pending",
          message: "Tenant created but table creation failed",
          error: tableError.message,
          data: {
            id: tenantData.tenantId,
            tenantId: tenantData.tenantId,
            tenantName: tenantData.tenantName,
            orgId: tenantData.orgId,
            url: configUrls.tenantUrl,
            userPoolId: cognitoResources.userPoolId,
            spPortalClientId: cognitoResources.spPortalClientId,
            awsConfigUrl: configUrls.awsConfig,
            brandingUrl: configUrls.branding,
            provisioningTime: `${duration}ms`,
            status: "tables_pending",
          },
          recovery: {
            action: "retry_table_creation",
            message: "Use the retry endpoint to create tables",
            endpoint: `/tenants/${tenantData.tenantId}/retry-tables`,
          },
        }),
      };
    }

    // ========================================
    // SUCCESS: Complete Response
    // ========================================
    const duration = Date.now() - startTime;
    console.log("\n" + "=".repeat(80));
    console.log(
      `[SUCCESS] Tenant '${tenantData.tenantId}' provisioned successfully in ${duration}ms`,
    );
    console.log("=".repeat(80));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: true,
        message: `Tenant '${tenantData.tenantId}' provisioned successfully`,
        data: {
          id: tenantData.tenantId,
          tenantId: tenantData.tenantId,
          tenantName: tenantData.tenantName,
          orgId: tenantData.orgId,
          url: configUrls.tenantUrl,
          userPoolId: cognitoResources.userPoolId,
          spPortalClientId: cognitoResources.spPortalClientId,
          awsConfigUrl: configUrls.awsConfig,
          brandingUrl: configUrls.branding,
          provisioningTime: `${duration}ms`,
          status: finalStatus,
          tables: tenantTables,
        },
      }),
    };
  } catch (error) {
    // ========================================
    // ERROR HANDLING & ROLLBACK
    // ========================================
    const duration = Date.now() - startTime;
    console.error("\n" + "=".repeat(80));
    console.error("[ERROR] Tenant provisioning failed:", error);
    console.error("=".repeat(80));

    // Perform rollback
    console.log("\n[ROLLBACK] Initiating rollback of provisioned resources...");
    try {
      await rollbackProvisioning(provisioningLog);

      // Validate rollback if we have a tenant ID
      if (tenantData?.tenantId) {
        const rollbackResults = await validateRollback(tenantData.tenantId);
        console.log("[ROLLBACK] Validation results:", rollbackResults);
      }

      console.log("[ROLLBACK] ✓ Rollback completed successfully");
    } catch (rollbackError) {
      console.error("[ROLLBACK] ✗ Rollback encountered errors:", rollbackError);
      // Continue to return error response
    }

    // Determine status code
    const statusCode = error.statusCode || 500;

    // Return error response
    return {
      statusCode,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: false,
        message: "Tenant provisioning failed",
        error: error.message,
        tenantId: tenantData?.tenantId,
        provisioningTime: `${duration}ms`,
        rollbackPerformed: true,
        // Include validation errors if present
        ...(error.validationErrors && {
          validationErrors: error.validationErrors,
        }),
      }),
    };
  }
};

/**
 * Health check handler (for testing)
 */
export const healthCheck = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      status: "healthy",
      service: "tenant-provisioning-lambda",
      version: "2.0.0",
      timestamp: new Date().toISOString(),
    }),
  };
};

export default handler;
