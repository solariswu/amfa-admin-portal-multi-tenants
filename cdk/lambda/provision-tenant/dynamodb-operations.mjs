/**
 * DynamoDB Operations Module
 *
 * Handles all DynamoDB operations for tenant management:
 * - Save tenant data
 * - Check tenant existence
 * - Delete tenant data (for rollback)
 */

import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

/**
 * Save tenant data to DynamoDB
 *
 * @param {Object} tenantData - Validated tenant data
 * @param {Object} cognitoResources - Cognito resource IDs
 * @param {Object} asmData - ASM registration data
 * @param {Object} tenantTables - Per-tenant table names
 * @returns {Promise<void>}
 */
export async function saveTenantToDynamoDB(
  tenantData,
  cognitoResources,
  asmData,
  tenantTables,
) {
  const { tenantId, tenantName, contactEmail, orgId, samlproxy } = tenantData;
  const tableName = process.env.AMFATENANT_TABLE;

  if (!tableName) {
    throw new Error("AMFATENANT_TABLE environment variable is not set");
  }

  console.log(`[DynamoDB] Saving tenant ${tenantId} to table ${tableName}`);

  // Check if tenant already exists
  const exists = await checkTenantExists(tenantId);
  if (exists) {
    throw new Error(`Tenant ${tenantId} already exists in database`);
  }

  const rootDomain = process.env.ROOT_DOMAIN;
  const now = Date.now();

  const item = {
    id: { S: tenantId },
    name: { S: encodeURIComponent(tenantName) },
    contact: { S: contactEmail },
    org_id: { S: orgId },
    url: { S: `https://${tenantId}.${rootDomain}` },
    endUserSpUrl: { S: `https://${tenantId}.${rootDomain}` },
    samlproxy: { BOOL: samlproxy },
    userpool: { S: cognitoResources.userPoolId },
    userPoolArn: { S: cognitoResources.userPoolArn },
    spPortalClientId: { S: cognitoResources.spPortalClientId },
    samlClientId: { S: cognitoResources.samlClientId },
    oauthDomain: { S: cognitoResources.oauthDomain },
    // ASM data
    asmClientId: { S: asmData.asmClientId },
    mobileTokenKey: { S: asmData.mobileTokenKey },
    // Per-tenant table names
    authCodeTable: { S: tenantTables.authCodeTable },
    sessionIdTable: { S: tenantTables.sessionIdTable },
    totpTokenTable: { S: tenantTables.totpTokenTable },
    pwdHashTable: { S: tenantTables.pwdHashTable },
    configTable: { S: tenantTables.configTable },
    // Timestamps
    createdAt: { N: now.toString() },
    updatedAt: { N: now.toString() },
    // Provisioning metadata
    provisionedBy: { S: "provision-tenant-lambda" },
    provisionedAt: { S: new Date(now).toISOString() },
  };

  // Add optional fields if present
  if (tenantData.adminEmail) {
    item.adminEmail = { S: tenantData.adminEmail };
  }

  if (cognitoResources.samlClientSecret) {
    item.samlClientSecret = { S: cognitoResources.samlClientSecret };
  }

  const command = new PutItemCommand({
    TableName: tableName,
    Item: item,
    ConditionExpression: "attribute_not_exists(id)", // Prevent overwriting
  });

  try {
    await dynamodb.send(command);
    console.log(`[DynamoDB] Successfully saved tenant ${tenantId}`);
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      throw new Error(`Tenant ${tenantId} already exists`);
    }
    console.error(`[DynamoDB] Failed to save tenant ${tenantId}:`, error);
    throw new Error(`Failed to save tenant to database: ${error.message}`);
  }
}

/**
 * Check if tenant exists in DynamoDB
 *
 * @param {string} tenantId - Tenant ID to check
 * @returns {Promise<boolean>} True if tenant exists
 */
export async function checkTenantExists(tenantId) {
  const tableName = process.env.AMFATENANT_TABLE;

  if (!tableName) {
    throw new Error("AMFATENANT_TABLE environment variable is not set");
  }

  console.log(`[DynamoDB] Checking if tenant ${tenantId} exists`);

  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      id: { S: tenantId },
    },
    ProjectionExpression: "id",
  });

  try {
    const response = await dynamodb.send(command);
    const exists = !!response.Item;
    console.log(`[DynamoDB] Tenant ${tenantId} exists: ${exists}`);
    return exists;
  } catch (error) {
    console.error(`[DynamoDB] Error checking tenant existence:`, error);
    throw new Error(`Failed to check tenant existence: ${error.message}`);
  }
}

/**
 * Get tenant data from DynamoDB
 *
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object|null>} Tenant data or null if not found
 */
export async function getTenantFromDynamoDB(tenantId) {
  const tableName = process.env.AMFATENANT_TABLE;

  if (!tableName) {
    throw new Error("AMFATENANT_TABLE environment variable is not set");
  }

  console.log(`[DynamoDB] Getting tenant ${tenantId} from table`);

  const command = new GetItemCommand({
    TableName: tableName,
    Key: {
      id: { S: tenantId },
    },
  });

  try {
    const response = await dynamodb.send(command);
    if (!response.Item) {
      return null;
    }

    // Convert DynamoDB format to plain object
    return {
      id: response.Item.id?.S,
      name: decodeURIComponent(response.Item.name?.S || ""),
      contact: response.Item.contact?.S,
      orgId: response.Item.org_id?.S,
      url: response.Item.url?.S,
      userPoolId: response.Item.userpool?.S,
      // ... add other fields as needed
    };
  } catch (error) {
    console.error(`[DynamoDB] Error getting tenant:`, error);
    throw new Error(`Failed to get tenant: ${error.message}`);
  }
}

/**
 * Delete tenant from DynamoDB (used during rollback)
 *
 * @param {string} tenantId - Tenant ID to delete
 * @returns {Promise<void>}
 */
export async function deleteTenantFromDynamoDB(tenantId) {
  const tableName = process.env.AMFATENANT_TABLE;

  if (!tableName) {
    console.warn(
      "[DynamoDB] AMFATENANT_TABLE not set, skipping tenant deletion",
    );
    return;
  }

  console.log(`[DynamoDB] Deleting tenant ${tenantId} from table ${tableName}`);

  const command = new DeleteItemCommand({
    TableName: tableName,
    Key: {
      id: { S: tenantId },
    },
  });

  try {
    await dynamodb.send(command);
    console.log(`[DynamoDB] Successfully deleted tenant ${tenantId}`);
  } catch (error) {
    console.error(`[DynamoDB] Error deleting tenant:`, error);
    // Don't throw - this is cleanup, continue with other rollback steps
  }
}

/**
 * Get tenants by organization ID
 *
 * @param {string} orgId - Organization ID
 * @returns {Promise<Array>} List of tenants in the organization
 */
export async function getTenantsByOrgId(orgId) {
  const tableName = process.env.AMFATENANT_TABLE;

  if (!tableName) {
    throw new Error("AMFATENANT_TABLE environment variable is not set");
  }

  console.log(`[DynamoDB] Getting tenants for organization ${orgId}`);

  // Note: This assumes there's a GSI on org_id
  // If not, you'll need to scan the table (less efficient)
  const command = new QueryCommand({
    TableName: tableName,
    IndexName: "org_id-index", // Adjust based on your GSI name
    KeyConditionExpression: "org_id = :orgId",
    ExpressionAttributeValues: {
      ":orgId": { S: orgId },
    },
  });

  try {
    const response = await dynamodb.send(command);
    return response.Items || [];
  } catch (error) {
    // If GSI doesn't exist, log warning and return empty array
    console.warn(
      `[DynamoDB] Could not query by org_id (GSI may not exist):`,
      error.message,
    );
    return [];
  }
}

export default saveTenantToDynamoDB;
