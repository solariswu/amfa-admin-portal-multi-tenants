import {
  QueryCommand,
  DeleteItemCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CognitoIdentityProviderClient,
  DeleteGroupCommand,
  DescribeUserPoolCommand,
  DeleteUserPoolDomainCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  DeleteSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { validateTenantAccess } from "admin-auth";

/**
 * Feature flag: When true, hard-deletes all tenant-specific AWS resources.
 * When false, only deletes the tenant record, ASM client, and TA admin group (soft delete).
 *
 * Set to false in production until you're confident in the cleanup logic.
 */
const HARD_DELETE_ENABLED = true;

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});
const secretsManager = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});
const s3 = new S3Client({ region: process.env.AWS_REGION });

/**
 * Per-tenant DynamoDB table name prefixes.
 * Each tenant gets tables: amfa-{prefix}-{tenantId}
 */
const PER_TENANT_TABLE_PREFIXES = [
  "authcode",
  "sessionid",
  "totptoken",
  "pwdhash",
  "spinfo",
  "importjobid",
];

/**
 * Per-tenant Secrets Manager secret paths.
 * Each tenant gets secrets: apersona/{tenantId}/{suffix}
 */
const PER_TENANT_SECRET_SUFFIXES = ["smtp", "secret", "asm"];

/**
 * Config types stored in amfa-configtable for each tenant.
 */
const CONFIG_TYPES = [
  "amfaBrandings",
  "amfaConfigs",
  "amfaLegals",
  "amfaPolicies",
];

// ============================================================
// Helper: Extract requester email from JWT
// ============================================================
function extractRequesterEmail(event) {
  try {
    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const jwt = authHeader.replace("Bearer ", "");
    const jwtBase64Url = jwt.split(".")[1];
    const jwtBase64 = jwtBase64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jwtBuffer = Buffer.from(jwtBase64, "base64");
    const jwtPayload = JSON.parse(jwtBuffer.toString("ascii"));
    return jwtPayload.email || "unknown";
  } catch (error) {
    console.warn("Failed to extract requester email from JWT:", error.message);
    return "unknown";
  }
}

// ============================================================
// Step 1: Delete ASM client (external dependency — do first)
// ============================================================
async function deleteAsmClient(tenantId, requesterEmail, orgId) {
  const asmPortalUrl = process.env.ASM_PORTAL_URL;
  if (!asmPortalUrl) {
    console.warn(
      "[ASM] ASM_PORTAL_URL not configured, skipping ASM client deletion",
    );
    return;
  }

  const tenantSecretName = `apersona/asm/tenant/${tenantId}`;
  console.log(`[ASM] Reading tenant credentials from ${tenantSecretName}...`);

  let tenantCredentials;
  try {
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: tenantSecretName }),
    );
    tenantCredentials = JSON.parse(secretResult.SecretString);
  } catch (secretError) {
    console.error(
      `[ASM] Failed to read tenant credentials (${tenantSecretName}):`,
      secretError.message,
    );
    throw new Error(`Cannot delete ASM client: tenant credentials not found`);
  }

  const asmClientId = tenantCredentials.asmClientId;
  const asmClientSecretKey = tenantCredentials.asmClientSecretKey || "";
  const resolvedOrgId = tenantCredentials.orgId || orgId;

  if (!asmClientId) {
    console.warn(
      "[ASM] No asmClientId found for tenant, skipping ASM deletion",
    );
    return;
  }

  const orgSecretName = `apersona/asm/org/${resolvedOrgId}`;
  console.log(`[ASM] Reading org credentials from ${orgSecretName}...`);

  let orgCredentials;
  try {
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: orgSecretName }),
    );
    orgCredentials = JSON.parse(secretResult.SecretString);
  } catch (secretError) {
    console.error(
      `[ASM] Failed to read org credentials (${orgSecretName}):`,
      secretError.message,
    );
    throw new Error(`Cannot delete ASM client: org credentials not found`);
  }

  const asmSecretKey = orgCredentials.asmSecretKey;
  if (!asmSecretKey) {
    console.warn("[ASM] No asmSecretKey found for org, skipping ASM deletion");
    return;
  }

  console.log(`[ASM] Deleting ASM client...`);
  console.log(`[ASM]   URL: ${asmPortalUrl}/deleteAsmClient.ap`);
  console.log(`[ASM]   asmClientId: ${asmClientId}`);
  console.log(`[ASM]   requestedBy: ${requesterEmail}`);

  const formData = new URLSearchParams({
    asmClientId: asmClientId,
    requestedBy: requesterEmail,
    asmSecretKey: asmSecretKey,
    asmClientSecretKey: asmClientSecretKey || asmSecretKey,
  });

  const response = await fetch(`${asmPortalUrl}/deleteAsmClient.ap`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ASM deleteAsmClient failed (${response.status}): ${errorText}`,
    );
  }

  const result = await response.json();
  console.log(`[ASM] ✓ ASM client deleted:`, JSON.stringify(result));
  return result;
}

// ============================================================
// Step 2: Delete Cognito UserPool domain
// ============================================================
async function deleteCognitoUserPoolDomain(tenantItem) {
  const userPoolId = tenantItem.userpool?.S;
  if (!userPoolId) {
    console.warn(
      "[Cognito] No userpool ID in tenant record, skipping domain deletion",
    );
    return;
  }

  console.log(`[Cognito] Describing UserPool ${userPoolId} to find domain...`);

  const describeResult = await cognito.send(
    new DescribeUserPoolCommand({ UserPoolId: userPoolId }),
  );

  const domain = describeResult.UserPool?.Domain;
  if (!domain) {
    console.log("[Cognito] No domain configured on UserPool, skipping");
    return;
  }

  console.log(`[Cognito] Deleting UserPool domain: ${domain}`);
  await cognito.send(
    new DeleteUserPoolDomainCommand({
      Domain: domain,
      UserPoolId: userPoolId,
    }),
  );
  console.log(`[Cognito] ✓ UserPool domain '${domain}' deleted`);
}

// ============================================================
// Step 3: Delete S3 config files from both buckets
// ============================================================
async function deleteS3ConfigFiles(tenantId) {
  const accountId = process.env.ACCOUNT_ID;
  const region = process.env.AWS_REGION;
  // Bucket names follow naming conventions set in CDK
  const spPortalBucket =
    process.env.SP_PORTAL_BUCKET || `sp-portal-shared-${accountId}-${region}`;
  const amfaServiceBucket = `amfa-service-shared-${accountId}-${region}`;

  const filesToDelete = [
    { bucket: spPortalBucket, key: `awsconfig_${tenantId}.json` },
    { bucket: spPortalBucket, key: `branding_${tenantId}.json` },
    { bucket: amfaServiceBucket, key: `awsconfig_${tenantId}.json` },
  ];

  for (const { bucket, key } of filesToDelete) {
    if (!bucket) {
      console.warn(`[S3] Bucket not configured, skipping deletion of ${key}`);
      continue;
    }
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      console.log(`[S3] ✓ Deleted s3://${bucket}/${key}`);
    } catch (error) {
      console.error(
        `[S3] ✗ Failed to delete s3://${bucket}/${key}:`,
        error.message,
      );
      // Non-fatal
    }
  }
}

// ============================================================
// Step 4: Delete config entries from amfa-configtable
// ============================================================
async function deleteConfigEntries(tenantId, dynamodb) {
  const configTable = "amfa-configtable";

  for (const configType of CONFIG_TYPES) {
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
      console.log(`[Config] ✓ Deleted ${configType} for tenant ${tenantId}`);
    } catch (error) {
      console.error(
        `[Config] ✗ Failed to delete ${configType} for ${tenantId}:`,
        error.message,
      );
      // Non-fatal
    }
  }
}

// ============================================================
// Step 5: Delete per-tenant Secrets Manager secrets
// ============================================================
async function deleteTenantSecrets(tenantId) {
  for (const suffix of PER_TENANT_SECRET_SUFFIXES) {
    const secretName = `apersona/${tenantId}/${suffix}`;
    try {
      await secretsManager.send(
        new DeleteSecretCommand({
          SecretId: secretName,
          ForceDeleteWithoutRecovery: true,
        }),
      );
      console.log(`[Secrets] ✓ Deleted secret: ${secretName}`);
    } catch (error) {
      if (error.name === "ResourceNotFoundException") {
        console.log(`[Secrets] Secret ${secretName} not found, skipping`);
      } else {
        console.error(
          `[Secrets] ✗ Failed to delete ${secretName}:`,
          error.message,
        );
        // Non-fatal
      }
    }
  }

  // Also delete ASM tenant secret
  const asmTenantSecret = `apersona/asm/tenant/${tenantId}`;
  try {
    await secretsManager.send(
      new DeleteSecretCommand({
        SecretId: asmTenantSecret,
        ForceDeleteWithoutRecovery: true,
      }),
    );
    console.log(`[Secrets] ✓ Deleted secret: ${asmTenantSecret}`);
  } catch (error) {
    if (error.name === "ResourceNotFoundException") {
      console.log(`[Secrets] Secret ${asmTenantSecret} not found, skipping`);
    } else {
      console.error(
        `[Secrets] ✗ Failed to delete ${asmTenantSecret}:`,
        error.message,
      );
    }
  }
}

// ============================================================
// Step 6: Delete per-tenant DynamoDB tables
// ============================================================
async function deleteTenantTables(tenantId, dynamodb) {
  for (const prefix of PER_TENANT_TABLE_PREFIXES) {
    const tableName = `amfa-${prefix}-${tenantId}`;
    try {
      // Check if table exists first
      await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));

      // Table exists — delete it
      await dynamodb.send(new DeleteTableCommand({ TableName: tableName }));
      console.log(`[DynamoDB] ✓ Deleted table: ${tableName}`);
    } catch (error) {
      if (
        error.name === "ResourceNotFoundException" ||
        error.name === "ResourceInUseException"
      ) {
        console.log(
          `[DynamoDB] Table ${tableName} not found or in use, skipping`,
        );
      } else {
        console.error(
          `[DynamoDB] ✗ Failed to delete table ${tableName}:`,
          error.message,
        );
        // Non-fatal
      }
    }
  }
}

// ============================================================
// Step 7: Delete TA group from admin userpool
// ============================================================
async function deleteTAGroup(tenantId) {
  const adminUserPoolId = process.env.ADMIN_USERPOOL_ID;
  if (!adminUserPoolId) {
    console.warn(
      "[Cognito] ADMIN_USERPOOL_ID not configured, skipping TA group deletion",
    );
    return;
  }

  const groupName = `TA_${tenantId}`;
  try {
    await cognito.send(
      new DeleteGroupCommand({
        GroupName: groupName,
        UserPoolId: adminUserPoolId,
      }),
    );
    console.log(
      `[Cognito] ✓ Deleted group '${groupName}' from admin userpool ${adminUserPoolId}`,
    );
  } catch (groupError) {
    if (groupError.name === "ResourceNotFoundException") {
      console.log(
        `[Cognito] Group '${groupName}' not found in admin userpool, skipping`,
      );
    } else {
      console.error(
        `[Cognito] ✗ Failed to delete group '${groupName}':`,
        groupError.message,
      );
    }
  }
}

// ============================================================
// Step 8: Delete tenant record from DynamoDB (LAST)
// ============================================================
async function deleteTenantRecord(tenantId, sk, dynamodb) {
  const params = {
    Key: {
      id: { S: `TENANT#${tenantId}` },
      sk: { S: sk },
    },
    TableName: `amfa-tenanttable`,
  };

  await dynamodb.send(new DeleteItemCommand(params));
  console.log(`[DynamoDB] ✓ Deleted tenant record: TENANT#${tenantId}`);
}

// ============================================================
// Main delete handler
// ============================================================
export const deleteResData = async (event, dynamodb) => {
  const tenantId = event.pathParameters?.id;

  // Validate access using lambda layer
  const authResult = await validateTenantAccess(event, tenantId);

  if (!authResult.authorized) {
    const error = new Error(authResult.error || "Access Denied");
    error.statusCode = authResult.statusCode || 403;
    throw error;
  }

  // Query tenant record to get sk and other info
  const queryParams = {
    TableName: `amfa-tenanttable`,
    KeyConditionExpression: "id = :id AND begins_with(sk, :sk_prefix)",
    ExpressionAttributeValues: {
      ":id": { S: `TENANT#${tenantId}` },
      ":sk_prefix": { S: "TENANT#" },
    },
  };

  const queryResult = await dynamodb.send(new QueryCommand(queryParams));

  if (!queryResult.Items || queryResult.Items.length === 0) {
    const error = new Error(`Tenant ${tenantId} not found`);
    error.statusCode = 404;
    throw error;
  }

  const currentItem = queryResult.Items[0];
  const sk = currentItem.sk.S;
  const orgId = currentItem.org_id?.S || "";

  console.log("=".repeat(60));
  console.log(`[DELETE] Starting tenant deletion: ${tenantId}`);
  console.log(`[DELETE] HARD_DELETE_ENABLED: ${HARD_DELETE_ENABLED}`);
  console.log("=".repeat(60));

  const requesterEmail = extractRequesterEmail(event);

  // ---- Step 1: Delete ASM client (always, needs credentials before secrets are deleted) ----
  try {
    await deleteAsmClient(tenantId, requesterEmail, orgId);
  } catch (asmError) {
    console.error(
      `[ASM] ✗ Failed to delete ASM client (non-fatal):`,
      asmError.message,
    );
  }

  if (HARD_DELETE_ENABLED) {
    // ---- Step 2: Delete Cognito UserPool domain ----
    try {
      await deleteCognitoUserPoolDomain(currentItem);
    } catch (error) {
      console.error(
        `[Cognito] ✗ Failed to delete UserPool domain (non-fatal):`,
        error.message,
      );
    }

    // ---- Step 3: Delete S3 config files ----
    try {
      await deleteS3ConfigFiles(tenantId);
    } catch (error) {
      console.error(
        `[S3] ✗ Failed to delete config files (non-fatal):`,
        error.message,
      );
    }

    // ---- Step 4: Delete config entries from amfa-configtable ----
    try {
      await deleteConfigEntries(tenantId, dynamodb);
    } catch (error) {
      console.error(
        `[Config] ✗ Failed to delete config entries (non-fatal):`,
        error.message,
      );
    }

    // ---- Step 5: Delete per-tenant Secrets Manager secrets ----
    try {
      await deleteTenantSecrets(tenantId);
    } catch (error) {
      console.error(
        `[Secrets] ✗ Failed to delete tenant secrets (non-fatal):`,
        error.message,
      );
    }

    // ---- Step 6: Delete per-tenant DynamoDB tables ----
    try {
      await deleteTenantTables(tenantId, dynamodb);
    } catch (error) {
      console.error(
        `[DynamoDB] ✗ Failed to delete tenant tables (non-fatal):`,
        error.message,
      );
    }
  }

  // ---- Step 7: Delete TA group from admin userpool (always) ----
  await deleteTAGroup(tenantId);

  // ---- Step 8: Delete tenant record (LAST — so retry is possible if above steps fail) ----
  await deleteTenantRecord(tenantId, sk, dynamodb);

  console.log("=".repeat(60));
  console.log(`[DELETE] ✓ Tenant '${tenantId}' deletion completed`);
  console.log(`[DELETE] HARD_DELETE performed: ${HARD_DELETE_ENABLED}`);
  console.log("=".repeat(60));

  return {};
};

export default deleteResData;
