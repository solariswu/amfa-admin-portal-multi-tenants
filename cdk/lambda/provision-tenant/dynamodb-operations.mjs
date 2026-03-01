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
 * @param {Object} tenantTables - Per-tenant table names (can be null if tables not created yet)
 * @param {string} status - Tenant status (default: 'provisioning')
 * @returns {Promise<void>}
 */
export async function saveTenantToDynamoDB(
  tenantData,
  cognitoResources,
  asmData,
  tenantTables = null,
  status = "provisioning",
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

  const rootDomain = process.env.ROOT_DOMAIN_NAME;
  const now = new Date().toISOString();
  const timestamp = Date.now();

  const item = {
    // Composite key
    id: { S: `TENANT#${tenantId}` },
    sk: { S: `TENANT#${now}` },

    // Entity type
    type: { S: "tenant" },

    // Tenant data
    name: { S: encodeURIComponent(tenantName) },
    contact: { S: contactEmail },
    org_id: { S: orgId },
    url: { S: `https://${tenantId}.${rootDomain}` },
    endUserSpUrl: { S: `https://${tenantId}.login.${rootDomain}` },
    samlproxy: { BOOL: samlproxy },
    userpool: { S: cognitoResources.userPoolId },
    userPoolArn: { S: cognitoResources.userPoolArn },
    spPortalClientId: { S: cognitoResources.spPortalClientId },
    samlClientId: { S: cognitoResources.samlClientId },
    oauthDomain: { S: cognitoResources.oauthDomain },
    // ASM data
    asmClientId: { S: asmData.asmClientId },
    mobileTokenKey: { S: asmData.mobileTokenKey },
    // Audit timestamps
    created_at: { S: now },
    updated_at: { S: now },
    createdAt: { N: timestamp.toString() },
    updatedAt: { N: timestamp.toString() },
    // Provisioning metadata
    provisionedBy: { S: "provision-tenant-lambda" },
    provisionedAt: { S: now },
    // Status
    status: { S: status },
    // Version for optimistic locking
    version: { N: "1" },
  };

  // Table names are no longer stored in DynamoDB.
  // They follow a fixed convention: amfa-{type}-{tenantId} and are derived at runtime.

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

  // Use Query with composite key (id + sk)
  const command = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "id = :id AND begins_with(sk, :sk_prefix)",
    ExpressionAttributeValues: {
      ":id": { S: `TENANT#${tenantId}` },
      ":sk_prefix": { S: "TENANT#" },
    },
    ProjectionExpression: "id",
    Limit: 1,
  });

  try {
    const response = await dynamodb.send(command);
    const exists = response.Items && response.Items.length > 0;
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

  // Use Query with composite key
  const command = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "id = :id AND begins_with(sk, :sk_prefix)",
    ExpressionAttributeValues: {
      ":id": { S: `TENANT#${tenantId}` },
      ":sk_prefix": { S: "TENANT#" },
    },
  });

  try {
    const response = await dynamodb.send(command);
    if (!response.Items || response.Items.length === 0) {
      console.log(`[DynamoDB] Tenant ${tenantId} not found`);
      return null;
    }

    const item = response.Items[0];

    // Convert DynamoDB format to plain object
    return {
      id: tenantId,
      sk: item.sk?.S || "",
      name: decodeURIComponent(item.name?.S || ""),
      contact: item.contact?.S,
      orgId: item.org_id?.S,
      url: item.url?.S,
      userPoolId: item.userpool?.S,
      userPoolArn: item.userPoolArn?.S,
      spPortalClientId: item.spPortalClientId?.S,
      samlClientId: item.samlClientId?.S,
      oauthDomain: item.oauthDomain?.S,
      status: item.status?.S || "active",
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

  try {
    // First, get the tenant to retrieve its sk
    const tenant = await getTenantFromDynamoDB(tenantId);

    if (!tenant) {
      console.log(`[DynamoDB] Tenant ${tenantId} not found, nothing to delete`);
      return;
    }

    // Delete using composite key
    const command = new DeleteItemCommand({
      TableName: tableName,
      Key: {
        id: { S: `TENANT#${tenantId}` },
        sk: { S: tenant.sk },
      },
    });

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

/**
 * Update tenant status and additional attributes
 *
 * @param {string} tenantId - Tenant ID to update
 * @param {string} status - New status value
 * @param {Object} additionalAttributes - Additional attributes to update
 * @returns {Promise<void>}
 */
export async function updateTenantStatus(
  tenantId,
  status,
  additionalAttributes = {},
) {
  const tableName = process.env.AMFATENANT_TABLE;

  if (!tableName) {
    throw new Error("AMFATENANT_TABLE environment variable is not set");
  }

  console.log(`[DynamoDB] Updating tenant ${tenantId} status to: ${status}`);

  // First, get the tenant to retrieve its sk
  const tenant = await getTenantFromDynamoDB(tenantId);

  if (!tenant) {
    throw new Error(`Tenant ${tenantId} not found`);
  }

  const now = new Date().toISOString();
  const timestamp = Date.now();

  // Build update expression dynamically
  const updateExpressions = [
    "#status = :status",
    "#updated_at = :updated_at",
    "#updatedAt = :updatedAt",
  ];
  const expressionAttributeNames = {
    "#status": "status",
    "#updated_at": "updated_at",
    "#updatedAt": "updatedAt",
  };
  const expressionAttributeValues = {
    ":status": { S: status },
    ":updated_at": { S: now },
    ":updatedAt": { N: timestamp.toString() },
  };

  // Add additional attributes to update
  Object.entries(additionalAttributes).forEach(([key, value]) => {
    const attrName = `#${key.replace(/\./g, "_")}`;
    const attrValue = `:${key.replace(/\./g, "_")}`;

    updateExpressions.push(`${attrName} = ${attrValue}`);
    expressionAttributeNames[attrName] = key;

    // Convert value to DynamoDB format
    if (typeof value === "string") {
      expressionAttributeValues[attrValue] = { S: value };
    } else if (typeof value === "number") {
      expressionAttributeValues[attrValue] = { N: value.toString() };
    } else if (typeof value === "boolean") {
      expressionAttributeValues[attrValue] = { BOOL: value };
    } else if (typeof value === "object" && value !== null) {
      // For complex objects, store as JSON string
      expressionAttributeValues[attrValue] = { S: JSON.stringify(value) };
    }
  });

  const { UpdateItemCommand } = await import("@aws-sdk/client-dynamodb");

  const command = new UpdateItemCommand({
    TableName: tableName,
    Key: {
      id: { S: `TENANT#${tenantId}` },
      sk: { S: tenant.sk },
    },
    UpdateExpression: `SET ${updateExpressions.join(", ")}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: "ALL_NEW",
  });

  try {
    await dynamodb.send(command);
    console.log(`[DynamoDB] Successfully updated tenant ${tenantId}`);
  } catch (error) {
    console.error(`[DynamoDB] Failed to update tenant ${tenantId}:`, error);
    throw new Error(`Failed to update tenant status: ${error.message}`);
  }
}

export default saveTenantToDynamoDB;
