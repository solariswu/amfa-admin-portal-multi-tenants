import {
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  ScanCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";

import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

import {
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  DeleteGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const secretsManager = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});
const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

// Secret name patterns
const ORG_SECRET_PREFIX = "apersona/asm/org/";
const INSTALL_KEY_SECRET = "apersona/asm/installkey";

/**
 * List all organizations from DynamoDB
 * Organizations are stored with id prefix "ORG#" and type="organization"
 * Uses GSI for efficient querying and returns only active organizations
 */
export async function listOrganizations(dynamodb, tableName) {
  console.log("Listing organizations from table:", tableName);

  // Use GSI for more efficient query
  const params = {
    TableName: tableName,
    IndexName: "type-created-index",
    KeyConditionExpression: "#type = :type",
    FilterExpression: "#status = :status", // Only active orgs
    ExpressionAttributeNames: {
      "#type": "type",
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":type": { S: "organization" },
      ":status": { S: "active" },
    },
    ScanIndexForward: false, // Newest first
  };

  const result = await dynamodb.send(new QueryCommand(params));
  console.log(`Found ${result.Items?.length || 0} organizations`);

  return (result.Items || []).map((item) => ({
    id: item.id.S.replace("ORG#", ""),
    name: item.name?.S || "",
    description: item.description?.S || "",
    created_at: item.created_at?.S || "",
    created_by: item.created_by?.S || "",
    created_by_name: item.created_by_name?.S || "",
    updated_at: item.updated_at?.S || "",
    updated_by: item.updated_by?.S || "",
    updated_by_name: item.updated_by_name?.S || "",
    version: parseInt(item.version?.N || "1"),
    status: item.status?.S || "active",
  }));
}

/**
 * Get ASM install key from Secrets Manager.
 * Returns null if not found.
 */
async function getInstallKeyFromSecrets() {
  try {
    const secret = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: INSTALL_KEY_SECRET }),
    );
    const data = JSON.parse(secret.SecretString);
    return data.installKey || null;
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      console.log("[ASM] Install key not found in Secrets Manager");
      return null;
    }
    console.error("[ASM] Error reading install key:", error.message);
    return null;
  }
}

/**
 * Store ASM install key in Secrets Manager for future use.
 */
async function storeInstallKey(installKey) {
  const secretString = JSON.stringify({ installKey });
  try {
    await secretsManager.send(
      new CreateSecretCommand({
        Name: INSTALL_KEY_SECRET,
        SecretString: secretString,
        Description: "ASM install key for createServiceProvider API",
      }),
    );
    console.log("[ASM] ✓ Install key stored in Secrets Manager");
  } catch (error) {
    if (error.name === "ResourceExistsException") {
      await secretsManager.send(
        new PutSecretValueCommand({
          SecretId: INSTALL_KEY_SECRET,
          SecretString: secretString,
        }),
      );
      console.log("[ASM] ✓ Install key updated in Secrets Manager");
    } else {
      console.error("[ASM] Warning: Failed to store install key:", error.message);
    }
  }
}

/**
 * Register organization with ASM portal as a Service Provider.
 *
 * Calls createServiceProvider.ap with asmSecretKey (install key) and stores
 * the returned serviceProviderId + asmSecretKey in Secrets Manager.
 *
 * Install key resolution order:
 * 1. Secrets Manager (apersona/asm/installkey) — set during deployment
 * 2. Request payload (data.asmInstallKey) — provided by SA user via frontend dialog
 * If neither exists, throws ASM_INSTALL_KEY_REQUIRED error.
 *
 * @param {string} orgId - Organization ID
 * @param {string} creatorEmail - Email of the admin user creating the org
 * @param {string|null} requestInstallKey - Install key from request payload (optional)
 * @returns {Promise<Object>} { serviceProviderId, asmSecretKey }
 */
async function registerOrgWithASM(orgId, creatorEmail, requestInstallKey = null) {
  const asmPortalUrl = process.env.ASM_PORTAL_URL;
  const awsAccount = process.env.ACCOUNT_ID;
  const awsRegion = process.env.AWS_REGION;

  if (!asmPortalUrl) {
    throw new Error("ASM_PORTAL_URL environment variable is required");
  }

  // Resolve install key: Secrets Manager first, then request payload
  let installKey = await getInstallKeyFromSecrets();

  if (!installKey && requestInstallKey) {
    installKey = requestInstallKey;
    // Store for future use
    await storeInstallKey(installKey);
  }

  if (!installKey) {
    const error = new Error("ASM Install Key is required to register organizations. Please provide it.");
    error.code = "ASM_INSTALL_KEY_REQUIRED";
    throw error;
  }

  console.log(`[ASM] Registering org '${orgId}' as Service Provider...`);
  console.log(`[ASM]   URL: ${asmPortalUrl}/createServiceProvider.ap`);
  console.log(`[ASM]   requestedBy: ${creatorEmail}`);

  const formData = new URLSearchParams({
    serviceProviderName: orgId,
    requestedBy: creatorEmail,
    awsAccountId: awsAccount,
    awsRegion: awsRegion,
    email: creatorEmail,
    awsSecretKey: installKey,
  });

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

  // Store in Secrets Manager (same pattern as provision-tenant/asm-shared.mjs)
  const secretName = `${ORG_SECRET_PREFIX}${orgId}`;
  const orgData = {
    serviceProviderId: String(result.serviceProviderId),
    asmSecretKey: result.asmSecretKey,
    serviceProviderName: result.serviceProviderName,
    orgId: orgId,
    contactEmail: creatorEmail,
    createdAt: new Date().toISOString(),
  };

  try {
    await secretsManager.send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: JSON.stringify(orgData),
        Description: `ASM Service Provider credentials for org: ${orgId}`,
        Tags: [
          { Key: "OrgId", Value: orgId },
          { Key: "CreatedBy", Value: "organizationslist-lambda" },
          { Key: "Purpose", Value: "ASM-service-provider" },
        ],
      }),
    );
    console.log(`[ASM] ✓ Org credentials stored in ${secretName}`);
  } catch (storeError) {
    if (storeError.name === "ResourceExistsException") {
      console.log(`[ASM] Secret already exists, updating...`);
      await secretsManager.send(
        new PutSecretValueCommand({
          SecretId: secretName,
          SecretString: JSON.stringify(orgData),
        }),
      );
    } else {
      throw new Error(
        `Failed to store org credentials in Secrets Manager: ${storeError.message}`,
      );
    }
  }

  return {
    serviceProviderId: String(result.serviceProviderId),
    asmSecretKey: result.asmSecretKey,
  };
}

/**
 * Create a new organization
 *
 * Flow: ASM registration first → Secrets Manager → DynamoDB
 * If ASM registration fails, nothing is persisted.
 */
export async function createOrganization(
  data,
  creatorEmail,
  creatorName,
  dynamodb,
  tableName,
) {
  console.log("Creating organization:", data);

  // Check if org already exists
  const existing = await getOrganization(data.id, dynamodb, tableName);
  if (existing) {
    throw new Error(`Organization '${data.id}' already exists`);
  }

  // Step 1: Register with ASM portal (fail-fast before saving to DB)
  let asmCredentials;
  try {
    asmCredentials = await registerOrgWithASM(data.id, creatorEmail, data.asmInstallKey || null);
  } catch (asmError) {
    console.error("[ASM] Organization registration failed:", asmError.message);
    // Preserve the error code for frontend to detect ASM_INSTALL_KEY_REQUIRED
    const err = new Error(`ASM registration failed: ${asmError.message}`);
    if (asmError.code) err.code = asmError.code;
    throw err;
  }

  // Step 2: Save organization to DynamoDB
  const now = new Date().toISOString();

  const params = {
    TableName: tableName,
    Item: {
      // Primary key
      id: { S: `ORG#${data.id}` },
      sk: { S: `ORG#${now}` }, // Sort key: type + timestamp

      // Entity type
      type: { S: "organization" },

      // Organization data
      name: { S: data.name },
      description: { S: data.description || "" },
      contact_email: { S: creatorEmail },

      // ASM Service Provider info
      asm_service_provider_id: { S: asmCredentials.serviceProviderId },

      // Audit fields - creation
      created_at: { S: now },
      created_by: { S: creatorEmail },
      created_by_name: { S: creatorName },

      // Audit fields - update tracking
      updated_at: { S: now },
      updated_by: { S: creatorEmail },
      updated_by_name: { S: creatorName },

      // Version for optimistic locking
      version: { N: "1" },

      // Status (for soft delete capability)
      status: { S: "active" },
    },
  };

  await dynamodb.send(new PutItemCommand(params));
  console.log("Organization created successfully:", data.id);

  // Step 3: Create SPA_<orgId> group in admin userpool
  const adminUserPoolId = process.env.ADMIN_USERPOOL_ID;
  if (adminUserPoolId) {
    const groupName = `SPA_${data.id}`;
    try {
      await cognito.send(
        new CreateGroupCommand({
          GroupName: groupName,
          UserPoolId: adminUserPoolId,
          Description: `Service Provider Admin for organization: ${data.id}`,
        }),
      );
      console.log(
        `[Cognito] ✓ Created group '${groupName}' in admin userpool ${adminUserPoolId}`,
      );
    } catch (groupError) {
      if (groupError.name === "GroupExistsException") {
        console.log(
          `[Cognito] Group '${groupName}' already exists in admin userpool, skipping`,
        );
      } else {
        console.error(
          `[Cognito] ✗ Failed to create group '${groupName}':`,
          groupError.message,
        );
        // Non-fatal: org was created successfully, group creation failure is logged but doesn't rollback
      }
    }
  } else {
    console.warn(
      "[Cognito] ADMIN_USERPOOL_ID not configured, skipping SPA group creation",
    );
  }

  return {
    id: data.id,
    name: data.name,
    description: data.description || "",
    contact_email: creatorEmail,
    asm_service_provider_id: asmCredentials.serviceProviderId,
    created_at: now,
    created_by: creatorEmail,
    created_by_name: creatorName,
    updated_at: now,
    updated_by: creatorEmail,
    updated_by_name: creatorName,
    version: 1,
    status: "active",
  };
}

/**
 * Get a single organization by ID
 */
export async function getOrganization(orgId, dynamodb, tableName) {
  console.log("Getting organization:", orgId);

  // Query with begins_with on sort key to get the organization
  const params = {
    TableName: tableName,
    KeyConditionExpression: "id = :id AND begins_with(sk, :sk_prefix)",
    ExpressionAttributeValues: {
      ":id": { S: `ORG#${orgId}` },
      ":sk_prefix": { S: "ORG#" },
    },
  };

  const result = await dynamodb.send(new QueryCommand(params));

  if (!result.Items || result.Items.length === 0) {
    console.log("Organization not found:", orgId);
    return null;
  }

  const item = result.Items[0];

  return {
    id: orgId,
    sk: item.sk?.S || "",
    name: item.name?.S || "",
    description: item.description?.S || "",
    created_at: item.created_at?.S || "",
    created_by: item.created_by?.S || "",
    created_by_name: item.created_by_name?.S || "",
    updated_at: item.updated_at?.S || "",
    updated_by: item.updated_by?.S || "",
    updated_by_name: item.updated_by_name?.S || "",
    version: parseInt(item.version?.N || "1"),
    status: item.status?.S || "active",
  };
}

/**
 * Check if an organization has any active tenants using GSI
 */
export async function orgHasTenants(orgId, dynamodb, tableName) {
  console.log("Checking if org has tenants:", orgId);

  // Use GSI for efficient query
  const params = {
    TableName: tableName,
    IndexName: "org-id-index",
    KeyConditionExpression: "org_id = :orgId",
    FilterExpression: "#status = :status",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":orgId": { S: orgId },
      ":status": { S: "active" },
    },
    Limit: 1,
  };

  const result = await dynamodb.send(new QueryCommand(params));
  const hasTenants = result.Items && result.Items.length > 0;

  console.log(`Org ${orgId} has tenants:`, hasTenants);
  return hasTenants;
}

/**
 * Update an organization with optimistic locking
 */
export async function updateOrganization(
  orgId,
  data,
  updaterEmail,
  updaterName,
  dynamodb,
  tableName,
) {
  console.log("Updating organization:", orgId, data);

  // Get current organization including version
  const existing = await getOrganization(orgId, dynamodb, tableName);
  if (!existing) {
    throw new Error(`Organization '${orgId}' not found`);
  }

  const now = new Date().toISOString();

  const params = {
    TableName: tableName,
    Key: {
      id: { S: `ORG#${orgId}` },
      sk: { S: existing.sk },
    },
    UpdateExpression: `
      SET #name = :name, 
          description = :description, 
          updated_at = :updated_at,
          updated_by = :updated_by,
          updated_by_name = :updated_by_name,
          #version = #version + :inc
    `,
    ConditionExpression: "#version = :current_version",
    ExpressionAttributeNames: {
      "#name": "name",
      "#version": "version",
    },
    ExpressionAttributeValues: {
      ":name": { S: data.name },
      ":description": { S: data.description || "" },
      ":updated_at": { S: now },
      ":updated_by": { S: updaterEmail },
      ":updated_by_name": { S: updaterName },
      ":current_version": { N: existing.version.toString() },
      ":inc": { N: "1" },
    },
    ReturnValues: "ALL_NEW",
  };

  try {
    const result = await dynamodb.send(new UpdateItemCommand(params));
    console.log("Organization updated successfully:", orgId);

    return {
      id: orgId,
      name: result.Attributes.name.S,
      description: result.Attributes.description?.S || "",
      created_at: result.Attributes.created_at?.S || "",
      created_by: result.Attributes.created_by?.S || "",
      created_by_name: result.Attributes.created_by_name?.S || "",
      updated_at: now,
      updated_by: updaterEmail,
      updated_by_name: updaterName,
      version: parseInt(result.Attributes.version.N),
      status: result.Attributes.status?.S || "active",
    };
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      throw new Error(
        "Organization was modified by another user. Please refresh and try again.",
      );
    }
    throw error;
  }
}

/**
 * Delete an organization (hard delete - only if it has no tenants)
 */
export async function deleteOrganization(orgId, dynamodb, tableName) {
  console.log("Deleting organization:", orgId);

  // Check if org has tenants
  const hasTenants = await orgHasTenants(orgId, dynamodb, tableName);
  if (hasTenants) {
    throw new Error(
      `Cannot delete organization '${orgId}' because it has tenants`,
    );
  }

  // Get current organization
  const existing = await getOrganization(orgId, dynamodb, tableName);
  if (!existing) {
    throw new Error(`Organization '${orgId}' not found`);
  }

  // Hard delete: remove the record from DynamoDB
  const params = {
    TableName: tableName,
    Key: {
      id: { S: `ORG#${orgId}` },
      sk: { S: existing.sk },
    },
  };

  await dynamodb.send(new DeleteItemCommand(params));
  console.log("Organization deleted successfully:", orgId);

  // Delete SPA_<orgId> group from admin userpool
  const adminUserPoolId = process.env.ADMIN_USERPOOL_ID;
  if (adminUserPoolId) {
    const groupName = `SPA_${orgId}`;
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
        // Non-fatal: org was deleted successfully
      }
    }
  } else {
    console.warn(
      "[Cognito] ADMIN_USERPOOL_ID not configured, skipping SPA group deletion",
    );
  }

  return true;
}
