/**
 * DynamoDB Table Provisioning Module
 *
 * Creates 4 per-tenant DynamoDB tables:
 * - amfa-authcode-{tenantId}
 * - amfa-sessionid-{tenantId}
 * - amfa-totptoken-{tenantId}
 * - amfa-pwdhash-{tenantId}
 *
 * Note: Config table (amfa-configtable) is created in CDK stack
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

/**
 * Create all 4 per-tenant DynamoDB tables
 *
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<Object>} Created table names
 */
export async function createTenantTables(tenantId) {
  console.log(`[Tables] Creating per-tenant tables for: ${tenantId}`);

  // Create all 4 tables in parallel
  const tables = [
    createAuthCodeTable(tenantId),
    createSessionIdTable(tenantId),
    createTotpTokenTable(tenantId),
    createPwdHashTable(tenantId),
    createSPInfoTable(tenantId),
    createImoprtJobTable(tenantId),
  ];

  await Promise.all(tables);

  console.log(
    `[Tables] Successfully created 4 per-tenant tables for ${tenantId}`,
  );

  // Return table names (config table already exists in CDK)
  return {
    authCodeTable: `amfa-authcode-${tenantId}`,
    sessionIdTable: `amfa-sessionid-${tenantId}`,
    totpTokenTable: `amfa-totptoken-${tenantId}`,
    pwdHashTable: `amfa-pwdhash-${tenantId}`,
    spInfoTable: `amfa-spinfo-${tenantId}`,
    importJobTable: `amfa-importjobid-${tenantId}`,
    configTable: `amfa-configtable`, // Reference existing
  };
}

/**
 * Table 1: Authentication Codes (per-tenant)
 * Composite key: username (PK) + apti (SK)
 * TTL enabled on 'ttl' attribute
 */
async function createAuthCodeTable(tenantId) {
  const tableName = `amfa-authcode-${tenantId}`;

  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [
      { AttributeName: "username", KeyType: "HASH" },
      { AttributeName: "apti", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "username", AttributeType: "S" },
      { AttributeName: "apti", AttributeType: "S" },
    ],
    BillingMode: "PAY_PER_REQUEST",
    TimeToLiveSpecification: {
      Enabled: true,
      AttributeName: "ttl",
    },
    Tags: [
      { Key: "TenantId", Value: tenantId },
      { Key: "TableType", Value: "authcode" },
      { Key: "ManagedBy", Value: "provision-tenant-lambda" },
    ],
  });

  await dynamodb.send(command);
  console.log(`[Tables] ✓ Created ${tableName}`);
}

/**
 * Table 2: Session IDs (per-tenant)
 * Single key: uuid (PK)
 * TTL enabled on 'ttl' attribute
 */
async function createSessionIdTable(tenantId) {
  const tableName = `amfa-sessionid-${tenantId}`;

  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [{ AttributeName: "uuid", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "uuid", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
    TimeToLiveSpecification: {
      Enabled: true,
      AttributeName: "ttl",
    },
    Tags: [
      { Key: "TenantId", Value: tenantId },
      { Key: "TableType", Value: "sessionid" },
      { Key: "ManagedBy", Value: "provision-tenant-lambda" },
    ],
  });

  await dynamodb.send(command);
  console.log(`[Tables] ✓ Created ${tableName}`);
}

/**
 * Table 3: TOTP Tokens (per-tenant)
 * Single key: id (PK)
 * No TTL
 */
async function createTotpTokenTable(tenantId) {
  const tableName = `amfa-totptoken-${tenantId}`;

  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
    Tags: [
      { Key: "TenantId", Value: tenantId },
      { Key: "TableType", Value: "totptoken" },
      { Key: "ManagedBy", Value: "provision-tenant-lambda" },
    ],
  });

  await dynamodb.send(command);
  console.log(`[Tables] ✓ Created ${tableName}`);
}

/**
 * Table 4: Password Hashes (per-tenant)
 * Composite key: username (PK) + timestamp (SK)
 * IMPORTANT: No automatic deletion - passwords are sensitive data
 */
async function createPwdHashTable(tenantId) {
  const tableName = `amfa-pwdhash-${tenantId}`;

  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [
      { AttributeName: "username", KeyType: "HASH" },
      { AttributeName: "timestamp", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "username", AttributeType: "S" },
      { AttributeName: "timestamp", AttributeType: "N" },
    ],
    BillingMode: "PAY_PER_REQUEST",
    Tags: [
      { Key: "TenantId", Value: tenantId },
      { Key: "TableType", Value: "pwdhash" },
      { Key: "ManagedBy", Value: "provision-tenant-lambda" },
      { Key: "RetentionPolicy", Value: "RETAIN" },
    ],
  });

  await dynamodb.send(command);
  console.log(`[Tables] ✓ Created ${tableName} (RETAIN policy)`);
}

/**
 * Table 5: SP Info (per-tenant)
 * Single key: id (PK)
 * For storing SP metadata and configuration
 */
async function createSPInfoTable(tenantId) {
  const tableName = `amfa-spinfo-${tenantId}`;

  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
    Tags: [
      { Key: "TenantId", Value: tenantId },
      { Key: "TableType", Value: "spinfo" },
      { Key: "ManagedBy", Value: "provision-tenant-lambda" },
    ],
  });

  await dynamodb.send(command);
  console.log(`[Tables] ✓ Created ${tableName}`);
}

/**
 * Table 6: Import User job (per-tenant)
 * Single key: id (PK)
 * For storing import job status and metadata
 */
async function createImoprtJobTable(tenantId) {
  const tableName = `amfa-importjobid-${tenantId}`;

  const command = new CreateTableCommand({
    TableName: tableName,
    KeySchema: [{ AttributeName: "jobid", KeyType: "HASH" }],
    AttributeDefinitions: [{ AttributeName: "jobid", AttributeType: "S" }],
    BillingMode: "PAY_PER_REQUEST",
    TimeToLiveSpecification: {
      Enabled: true,
      AttributeName: "ttl",
    },
    Tags: [
      { Key: "TenantId", Value: tenantId },
      { Key: "TableType", Value: "importjob" },
      { Key: "ManagedBy", Value: "provision-tenant-lambda" },
    ],
  });

  await dynamodb.send(command);
  console.log(`[Tables] ✓ Created ${tableName}`);
}

/**
 * Delete per-tenant tables (for rollback)
 * NEVER delete the shared config table!
 *
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<void>}
 */
export async function deleteTenantTables(tenantId) {
  const tableNames = [
    `amfa-authcode-${tenantId}`,
    `amfa-sessionid-${tenantId}`,
    `amfa-totptoken-${tenantId}`,
    `amfa-pwdhash-${tenantId}`,
    `amfa-spinfo-${tenantId}`,
    `amfa-importjobid-${tenantId}`,
    // NOTE: Do NOT include config table - it's shared!
  ];

  console.log(
    `[Tables] Deleting ${tableNames.length} per-tenant tables for ${tenantId}`,
  );

  for (const tableName of tableNames) {
    try {
      await dynamodb.send(new DeleteTableCommand({ TableName: tableName }));
      console.log(`[Tables] ✓ Deleted ${tableName}`);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        console.log(`[Tables] ⊘ ${tableName} does not exist (already deleted)`);
      } else {
        console.error(
          `[Tables] ✗ Failed to delete ${tableName}:`,
          error.message,
        );
      }
      // Continue with other tables
    }
  }

  console.log(`[Tables] Rollback complete for ${tenantId}`);
  console.log(`[Tables] Shared config table preserved`);
}

/**
 * Verify all tables exist (for validation)
 *
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<Object>} Table existence status
 */
export async function verifyTenantTables(tenantId) {
  const tableNames = [
    `amfa-authcode-${tenantId}`,
    `amfa-sessionid-${tenantId}`,
    `amfa-totptoken-${tenantId}`,
    `amfa-pwdhash-${tenantId}`,
    `amfa-spinfo-${tenantId}`,
    `amfa-importjobid-${tenantId}`,
  ];

  const results = {};

  for (const tableName of tableNames) {
    try {
      const response = await dynamodb.send(
        new DescribeTableCommand({ TableName: tableName }),
      );
      results[tableName] = response.Table.TableStatus === "ACTIVE";
    } catch (error) {
      results[tableName] = false;
    }
  }

  return results;
}

export default createTenantTables;
