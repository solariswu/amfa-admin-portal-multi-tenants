#!/usr/bin/env node

/**
 * Migration Script: Add org_id='default' to existing tenants
 *
 * This script adds the org_id field to all existing tenants in the DynamoDB tenant table.
 * Tenants without an org_id will be assigned 'default' as their organization.
 *
 * Usage:
 *   node scripts/add-org-id-to-tenants.mjs
 *
 * Environment variables required:
 *   AWS_REGION - AWS region where the table exists
 *   AWS_ACCOUNT_ID - AWS account ID (optional, will be fetched if not provided)
 */

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const region = process.env.AWS_REGION || "us-east-1";
const dynamodb = new DynamoDBClient({ region });
const sts = new STSClient({ region });

async function getAccountId() {
  if (process.env.AWS_ACCOUNT_ID) {
    return process.env.AWS_ACCOUNT_ID;
  }

  try {
    const result = await sts.send(new GetCallerIdentityCommand({}));
    return result.Account;
  } catch (error) {
    console.error("Failed to get AWS account ID:", error);
    throw error;
  }
}

async function migrateTenantsToDefaultOrg() {
  console.log("=".repeat(60));
  console.log("Migration Script: Add org_id to tenants");
  console.log("=".repeat(60));

  const accountId = await getAccountId();
  const tableName = `amfa-tenanttable`;

  console.log(`\nAWS Account: ${accountId}`);
  console.log(`AWS Region: ${region}`);
  console.log(`Table Name: ${tableName}`);
  console.log("");

  // Scan all tenants
  console.log("Scanning tenant table...");
  let scanResult;
  try {
    scanResult = await dynamodb.send(
      new ScanCommand({
        TableName: tableName,
      }),
    );
  } catch (error) {
    console.error(`\n❌ Failed to scan table: ${error.message}`);
    if (error.name === "ResourceNotFoundException") {
      console.error(
        "Table does not exist. Please check the table name and region.",
      );
    }
    throw error;
  }

  if (!scanResult.Items || scanResult.Items.length === 0) {
    console.log("✓ No tenants found in the table.");
    console.log("\nMigration complete (nothing to do).");
    return;
  }

  console.log(`✓ Found ${scanResult.Items.length} tenant(s) in the table.\n`);

  // Count tenants that need migration
  const tenantsNeedingMigration = scanResult.Items.filter(
    (item) => !item.org_id,
  );
  const tenantsAlreadyMigrated = scanResult.Items.filter((item) => item.org_id);

  console.log(`Tenants already with org_id: ${tenantsAlreadyMigrated.length}`);
  console.log(`Tenants needing migration: ${tenantsNeedingMigration.length}\n`);

  if (tenantsNeedingMigration.length === 0) {
    console.log("✓ All tenants already have org_id assigned.");
    console.log("\nMigration complete (nothing to do).");
    return;
  }

  // Update each tenant that needs migration
  console.log("Starting migration...\n");
  let successCount = 0;
  let failCount = 0;

  for (const item of tenantsNeedingMigration) {
    const tenantId = item.id.S;
    const tenantName = item.name ? decodeURIComponent(item.name.S) : "Unknown";

    process.stdout.write(`  Migrating tenant: ${tenantId} (${tenantName})... `);

    try {
      await dynamodb.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key: { id: { S: tenantId } },
          UpdateExpression: "SET org_id = :orgId",
          ExpressionAttributeValues: {
            ":orgId": { S: "default" },
          },
        }),
      );
      console.log("✓ Success");
      successCount++;
    } catch (error) {
      console.log(`✗ Failed: ${error.message}`);
      failCount++;
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("Migration Summary");
  console.log("=".repeat(60));
  console.log(`Total tenants: ${scanResult.Items.length}`);
  console.log(`Already migrated: ${tenantsAlreadyMigrated.length}`);
  console.log(`Successfully migrated: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log("");

  if (failCount > 0) {
    console.log(
      "⚠️  Some tenants failed to migrate. Please check the errors above.",
    );
    process.exit(1);
  } else {
    console.log("✅ Migration completed successfully!");
  }
}

// Run migration
migrateTenantsToDefaultOrg().catch((error) => {
  console.error("\n❌ Migration failed:", error);
  process.exit(1);
});
