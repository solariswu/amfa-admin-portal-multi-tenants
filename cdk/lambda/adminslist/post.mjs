import {
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

// Import shared auth utilities from lambda layer
import {
  validateGroupCreationPermission,
  getAvailableTAGroupsForRole,
} from "admin-auth";

const secretsManager = new SecretsManagerClient({ region: process.env.AWS_REGION });

// Assign groups/applications to user
const assignApplications = async (groups, username, cognitoISP) => {
  return Promise.all(
    groups.map((group) =>
      cognitoISP.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: process.env.USERPOOL_ID,
          GroupName: group,
          Username: username,
        }),
      ),
    ),
  );
};

// Password generation helper functions
function getRandomUpper() {
  return String.fromCharCode(Math.floor(Math.random() * 26) + 65);
}

function getRandomLower() {
  return String.fromCharCode(Math.floor(Math.random() * 26) + 97);
}

function getRandomNumber() {
  return String.fromCharCode(Math.floor(Math.random() * 10) + 48);
}

function getRandomSymbol() {
  const symbols = "!@#$%^&*(){}[]=<>/,.";
  return symbols[Math.floor(Math.random() * symbols.length)];
}

const randomFunc = {
  upper: getRandomUpper,
  lower: getRandomLower,
  number: getRandomNumber,
  symbol: getRandomSymbol,
};

function generatePassword(lower, upper, number, symbol, length) {
  console.log(lower, upper, number, symbol, length);
  let generatedPassword = "";
  const typesCount = lower + upper + number + symbol;
  const typesArr = [{ lower }, { upper }, { number }, { symbol }].filter(
    (item) => Object.values(item)[0],
  );
  
  if (typesCount === 0) {
    return false;
  }

  for (let i = 0; i < length; i += typesCount) {
    typesArr.forEach((type) => {
      const funcName = Object.keys(type)[0];
      generatedPassword += randomFunc[funcName]();
    });
  }
  
  return generatedPassword.slice(0, length);
}

/**
 * Register SPA admin with ASM portal
 * Reads the org's serviceProviderId from Secrets Manager and calls addServiceProviderAdmin.ap
 *
 * @param {string} email - The SPA admin's email
 * @param {string} orgId - The organization ID
 * @param {string} requestedBy - The email of the user who initiated the request
 */
async function registerSPAAdminWithASM(email, orgId, requestedBy) {
  const asmPortalUrl = process.env.ASM_PORTAL_URL;
  if (!asmPortalUrl) {
    console.warn("[ASM] ASM_PORTAL_URL not configured, skipping SPA admin registration with ASM");
    return;
  }

  // Read org ASM credentials from Secrets Manager
  const secretName = `apersona/asm/org/${orgId}`;
  console.log(`[ASM] Reading org credentials from ${secretName}...`);

  let orgCredentials;
  try {
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    );
    orgCredentials = JSON.parse(secretResult.SecretString);
  } catch (secretError) {
    throw new Error(`Failed to read org credentials from Secrets Manager (${secretName}): ${secretError.message}`);
  }

  const serviceProviderId = orgCredentials.serviceProviderId;
  if (!serviceProviderId) {
    throw new Error(`No serviceProviderId found in org credentials for org '${orgId}'`);
  }

  console.log(`[ASM] Registering SPA admin with ASM portal...`);
  console.log(`[ASM]   URL: ${asmPortalUrl}/addServiceProviderAdmin.ap`);
  console.log(`[ASM]   email: ${email}`);
  console.log(`[ASM]   serviceProviderId: ${serviceProviderId}`);
  console.log(`[ASM]   requestedBy: ${requestedBy}`);

  const formData = new URLSearchParams({
    email: email,
    serviceProviderId: serviceProviderId,
    requestedBy: requestedBy,
  });

  const response = await fetch(`${asmPortalUrl}/addServiceProviderAdmin.ap`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ASM addServiceProviderAdmin failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log(`[ASM] ✓ SPA admin registered with ASM:`, JSON.stringify(result));

  return result;
}

/**
 * Register Tenant Admin with ASM portal
 * Reads tenant's asmClientId, org's asmSecretKey, and tenant name from DynamoDB/Secrets Manager
 * then calls tenantAdmin.ap
 *
 * @param {string} email - The TA admin's email
 * @param {string} tenantId - The tenant ID (our internal ID, e.g., "mytenant")
 * @param {string} requestedBy - The email of the user who initiated the request
 */
async function registerTAAdminWithASM(email, tenantId, requestedBy) {
  const asmPortalUrl = process.env.ASM_PORTAL_URL;
  if (!asmPortalUrl) {
    console.warn("[ASM] ASM_PORTAL_URL not configured, skipping TA admin registration with ASM");
    return;
  }

  // Step 1: Read tenant ASM credentials from Secrets Manager to get asmClientId and orgId
  const tenantSecretName = `apersona/asm/tenant/${tenantId}`;
  console.log(`[ASM] Reading tenant credentials from ${tenantSecretName}...`);

  let tenantCredentials;
  try {
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: tenantSecretName }),
    );
    tenantCredentials = JSON.parse(secretResult.SecretString);
  } catch (secretError) {
    throw new Error(`Failed to read tenant credentials from Secrets Manager (${tenantSecretName}): ${secretError.message}`);
  }

  const asmClientId = tenantCredentials.asmClientId;
  const orgId = tenantCredentials.orgId;
  if (!asmClientId) {
    throw new Error(`No asmClientId found in tenant credentials for tenant '${tenantId}'`);
  }
  if (!orgId) {
    throw new Error(`No orgId found in tenant credentials for tenant '${tenantId}'`);
  }

  // Step 2: Read org ASM credentials from Secrets Manager to get asmSecretKey
  const orgSecretName = `apersona/asm/org/${orgId}`;
  console.log(`[ASM] Reading org credentials from ${orgSecretName}...`);

  let orgCredentials;
  try {
    const secretResult = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: orgSecretName }),
    );
    orgCredentials = JSON.parse(secretResult.SecretString);
  } catch (secretError) {
    throw new Error(`Failed to read org credentials from Secrets Manager (${orgSecretName}): ${secretError.message}`);
  }

  const asmSecretKey = orgCredentials.asmSecretKey;
  if (!asmSecretKey) {
    throw new Error(`No asmSecretKey found in org credentials for org '${orgId}'`);
  }

  // Step 3: Read tenant name from DynamoDB
  let tenantName = tenantId; // fallback to tenantId if lookup fails
  try {
    const queryResult = await dynamodb.send(new QueryCommand({
      TableName: "amfa-tenanttable",
      KeyConditionExpression: "id = :id AND begins_with(sk, :sk_prefix)",
      ExpressionAttributeValues: {
        ":id": { S: `TENANT#${tenantId}` },
        ":sk_prefix": { S: "TENANT#" },
      },
    }));
    if (queryResult.Items && queryResult.Items.length > 0) {
      tenantName = queryResult.Items[0].name?.S || tenantId;
    }
  } catch (dbError) {
    console.warn(`[ASM] Could not read tenant name from DynamoDB (non-fatal): ${dbError.message}`);
  }

  const awsAccountId = process.env.ACCOUNT_ID || "";

  console.log(`[ASM] Registering TA admin with ASM portal...`);
  console.log(`[ASM]   URL: ${asmPortalUrl}/tenantAdmin.ap`);
  console.log(`[ASM]   tenantId (asmClientId): ${asmClientId}`);
  console.log(`[ASM]   tenantName: ${tenantName}`);
  console.log(`[ASM]   tenantAdminEmail: ${email}`);
  console.log(`[ASM]   action: add`);
  console.log(`[ASM]   requestedBy: ${requestedBy}`);
  console.log(`[ASM]   awsAccountId: ${awsAccountId}`);

  const formData = new URLSearchParams({
    tenantId: asmClientId,
    tenantName: tenantName,
    tenantAdminEmail: email,
    action: "add",
    requestedBy: requestedBy,
    awsAccountId: awsAccountId,
    asmSecretKey: asmSecretKey,
  });

  const response = await fetch(`${asmPortalUrl}/tenantAdmin.ap`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ASM tenantAdmin.ap failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log(`[ASM] ✓ TA admin registered with ASM:`, JSON.stringify(result));

  return result;
}

// Main function to create user
export const postResData = async (data, cognitoISP, requesterRoles = [], requesterEmail = "") => {
  console.log("postResData Input:", { data, requesterRoles, requesterEmail });

  const groups = [];
  const attributes = [];

  Object.keys(data).map((key) => {
    switch (key.toLowerCase()) {
      case "locale":
      case "profile":
      case "given_name":
      case "family_name":
      case "name":
      case "middle_name":
      case "picture":
      case "gender":
      case "birthdate":
        if (data[key]) {
          attributes.push({ Name: key.toLowerCase(), Value: data[key] });
        }
        break;
      case "email":
        if (data[key]) {
          attributes.push({
            Name: key.toLowerCase(),
            Value: data[key].toLowerCase(),
          });
          attributes.push({ Name: "email_verified", Value: "true" });
        }
        break;
      case "phone_number":
        if (data[key]) {
          attributes.push({ Name: key.toLowerCase(), Value: data[key] });
          attributes.push({ Name: "phone_number_verified", Value: "true" });
        }
        break;
      case "phone_number_verified":
        if (data[key]) {
          attributes.push({
            Name: key.toLowerCase(),
            Value: data[key] ? "true" : "false",
          });
        }
        break;
      case "groups":
        groups.push(...data[key]);
        break;
      case "alter-email":
      case "voice-number":
        if (data[key]) {
          attributes.push({ Name: `custom:${key}`, Value: data[key] });
        }
        break;
      default:
        break;
    }
    return key;
  });

  // RBAC validation using shared function from lambda layer
  if (groups.length > 0) {
    const validation = await validateGroupCreationPermission(
      requesterRoles,
      groups,
      cognitoISP,
    );
    if (!validation.isValid) {
      throw new Error(`RBAC Validation Failed: ${validation.error}`);
    }
  }

  // Set email as verified to allow email login
  attributes.push({ Name: "email_verified", Value: "true" });

  attributes.push({
    Name: "nickname",
    Value: data["given_name"] + " " + data["family_name"],
  });

  const params = {
    Username: data["email"].trim(),
    ...(!data.notify && { MessageAction: "SUPPRESS" }),
    TemporaryPassword: generatePassword(true, true, true, true, 10),
    UserAttributes: attributes,
    UserPoolId: process.env.USERPOOL_ID,
    DesiredDeliveryMediums: ["EMAIL"],
  };

  const resData = await cognitoISP.send(new AdminCreateUserCommand(params));
  const item = resData.User;

  if (item) {
    if (groups && groups.length > 0) {
      // Remove SA from groups (SA users should not be created this way)
      let finalGroups = groups.filter((group) => group !== "SA");
      
      // Prioritize SPA_yyy roles - if multiple SPA_yyy roles, keep only the first one
      const spaGroups = finalGroups.filter(group => group.startsWith("SPA_"));
      if (spaGroups.length > 0) {
        finalGroups = [spaGroups[0]];
      }

      if (finalGroups.length > 0) {
        try {
          await assignApplications(finalGroups, item.Username, cognitoISP);
        } catch (err) {
          console.log("create user - assignApplications/groups Error:", err);
        }
      }

      // Register SPA admin with ASM portal if assigned to an SPA_ group
      const spaGroup = finalGroups.find(g => g.startsWith("SPA_"));
      if (spaGroup) {
        const orgId = spaGroup.substring(4); // Extract orgId from SPA_<orgId>
        try {
          await registerSPAAdminWithASM(data["email"].trim().toLowerCase(), orgId, requesterEmail || data["email"].trim().toLowerCase());
        } catch (asmError) {
          console.error("[ASM] Failed to register SPA admin (non-fatal):", asmError.message);
          // Non-fatal: user was created and added to group successfully
        }
      }

      // Register TA admin with ASM portal if assigned to a TA_ group
      const taGroup = finalGroups.find(g => g.startsWith("TA_"));
      if (taGroup) {
        const tenantId = taGroup.substring(3); // Extract tenantId from TA_<tenantId>
        try {
          await registerTAAdminWithASM(data["email"].trim().toLowerCase(), tenantId, requesterEmail || data["email"].trim().toLowerCase());
        } catch (asmError) {
          console.error("[ASM] Failed to register TA admin (non-fatal):", asmError.message);
          // Non-fatal: user was created and added to group successfully
        }
      }
      
      // Update groups for response
      groups.length = 0;
      groups.push(...finalGroups);
    }

    const directMappingArrtibutes = [
      "email",
      "phone_number",
      "locale",
      "sub",
      "profile",
      "given_name",
      "family_name",
      "nickname",
      "name",
      "middle_name",
      "picture",
      "gender",
      "birthdate",
    ];
    const filteredAttributs = item.Attributes.filter((el) =>
      directMappingArrtibutes.includes(el.Name),
    );
    const result = Object.fromEntries(
      filteredAttributs.map((el) => [el.Name, el.Value]),
    );

    // Get email_verified and phone_number_verified from attributes
    const emailVerifiedAttr = item.Attributes.find(el => el.Name === "email_verified");
    const phoneVerifiedAttr = item.Attributes.find(el => el.Name === "phone_number_verified");

    return {
      id: item.Username,
      username: item.Username,
      enabled: item.Enabled,
      status: item.UserStatus,
      email_verified: emailVerifiedAttr?.Value === "true",
      phone_number_verified: phoneVerifiedAttr?.Value === "true",
      groups: groups.length > 0 ? groups : null,
      ...result,
    };
  }
};

// Export function to get available TA groups for frontend use
// Now using shared function from lambda layer
export { getAvailableTAGroupsForRole } from "admin-auth";

export default postResData;
