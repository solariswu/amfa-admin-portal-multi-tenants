import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminListGroupsForUserCommand,
  CreateGroupCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { getOrganization } from "./org-utils.mjs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const lambda = new LambdaClient({ region: process.env.AWS_REGION });
const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});
const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

/**
 * Create new tenant by invoking provision-tenant Lambda
 *
 * @param {Object} data - Tenant data from frontend
 * @param {string} requesterRole - 'SA' or 'SPA'
 * @param {string} requesterOrgId - Organization ID for SPA users
 * @param {string} requesterEmail - Email of the requester (from JWT)
 * @returns {Object} Created tenant data
 */
export async function createTenant(data, requesterRole, requesterOrgId, requesterEmail) {
  console.log("Creating tenant:", { data, requesterRole, requesterOrgId, requesterEmail });

  // 1. Validate authorization
  if (!requesterRole || (requesterRole !== "SA" && requesterRole !== "SPA")) {
    throw new Error(
      "Insufficient permissions. Only SA and SPA can create tenants.",
    );
  }

  // 2. Validate org authorization for SPA
  if (requesterRole === "SPA") {
    if (data.orgId !== requesterOrgId) {
      throw new Error(
        `SPA can only create tenants for their own org (${requesterOrgId})`,
      );
    }
  }

  // 3. Validate organization exists
  const tableName = `amfa-tenanttable`;
  const org = await getOrganization(data.orgId, dynamodb, tableName);

  if (!org) {
    throw new Error(
      `Organization '${data.orgId}' does not exist. Please create it first.`,
    );
  }

  console.log("Organization validated:", org);

  // 4. Invoke provision-tenant Lambda
  console.log("Invoking provision-tenant Lambda...");

  // Use requester email from JWT as contact/installer email
  const contactEmail = requesterEmail || data.contactEmail;
  if (!contactEmail) {
    throw new Error("Requester email could not be determined from JWT token");
  }

  const provisionPayload = {
    body: {
      tenantId: data.tenantId,
      tenantName: data.tenantName,
      orgId: data.orgId,
      contactEmail: contactEmail,
      adminEmail: data.adminEmail, // Mandatory tenant initial admin email
      samlproxy: data.samlproxy !== false, // Default true
    },
  };

  const invokeResult = await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.PROVISION_TENANT_FUNCTION_NAME,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify(provisionPayload),
    }),
  );

  // Parse result
  const responsePayload = JSON.parse(
    new TextDecoder().decode(invokeResult.Payload),
  );
  console.log("Provision result:", responsePayload);

  if (responsePayload.statusCode !== 200) {
    const errorBody =
      typeof responsePayload.body === "string"
        ? JSON.parse(responsePayload.body)
        : responsePayload.body;

    // Preserve the HTTP status code for proper error handling
    const error = new Error(
      errorBody.error || errorBody.message || "Tenant provisioning failed",
    );
    error.status = responsePayload.statusCode;
    error.statusCode = responsePayload.statusCode;
    error.body = errorBody;
    throw error;
  }

  const provisionedTenant =
    typeof responsePayload.body === "string"
      ? JSON.parse(responsePayload.body)
      : responsePayload.body;

  console.log("Tenant provisioned successfully:", provisionedTenant);

  // 5. Create TA_<tenantId> group in admin userpool
  const adminUserPoolId = process.env.ADMIN_USERPOOL_ID;
  if (adminUserPoolId) {
    const taGroupName = `TA_${data.tenantId}`;
    try {
      await cognito.send(
        new CreateGroupCommand({
          GroupName: taGroupName,
          UserPoolId: adminUserPoolId,
          Description: `Tenant Admin for ${data.tenantId}`,
        }),
      );
      console.log(
        `[Cognito] ✓ Created group '${taGroupName}' in admin userpool ${adminUserPoolId}`,
      );
    } catch (groupError) {
      if (groupError.name === "GroupExistsException") {
        console.log(
          `[Cognito] Group '${taGroupName}' already exists in admin userpool, skipping`,
        );
      } else {
        console.error(
          `[Cognito] ✗ Failed to create group '${taGroupName}' in admin userpool:`,
          groupError.message,
        );
        // Non-fatal: tenant was provisioned successfully
      }
    }
  } else {
    console.warn(
      "[Cognito] ADMIN_USERPOOL_ID not configured, skipping TA group creation in admin userpool",
    );
  }

  // 6. Create admin user in ADMIN userpool (not tenant userpool)
  // The TA_<tenantId> group was already created in step 5.
  // The TenantAdminList UI queries the admins resource (admin userpool) for TA_ group members.
  if (data.adminEmail && adminUserPoolId) {
    try {
      console.log("Creating tenant admin user in admin userpool:", data.adminEmail);

      await createAdminUser(
        adminUserPoolId, // Use admin userpool so user appears in TenantAdminList
        data.adminEmail,
        data.adminFirstName || "",
        data.adminLastName || "",
        data.tenantId,
        data.orgId,
      );

      console.log(`Tenant admin user created successfully in admin userpool: ${data.adminEmail}`);
    } catch (error) {
      console.error("Failed to create admin user (non-fatal):", error);
      // Don't fail the whole operation - tenant was created successfully
      // Just log the error
    }
  } else {
    console.warn("Skipping admin user creation:", {
      hasAdminEmail: !!data.adminEmail,
      hasAdminUserPoolId: !!adminUserPoolId,
    });
  }

  return provisionedTenant;
}

/**
 * Create admin user in admin UserPool and add to TA_<tenantId> group.
 *
 * If the user already exists, checks their current roles:
 * - SA (Super Admin) → skip TA_ group assignment (already has full access)
 * - SPA_<orgId> matching tenant's org → skip TA_ group assignment (org admin already covers this tenant)
 * - Otherwise → add user to TA_<tenantId> group
 *
 * @param {string} userPoolId - Cognito UserPool ID (admin userpool)
 * @param {string} email - Admin email
 * @param {string} firstName - Admin first name
 * @param {string} lastName - Admin last name
 * @param {string} tenantId - Tenant ID
 * @param {string} orgId - Organization ID that owns the tenant
 */
async function createAdminUser(
  userPoolId,
  email,
  firstName,
  lastName,
  tenantId,
  orgId,
) {
  console.log("Creating admin user in UserPool:", {
    userPoolId,
    email,
    tenantId,
    orgId,
  });

  // 1. Create user (or skip if user already exists)
  let userAlreadyExists = false;
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          { Name: "given_name", Value: firstName },
          { Name: "family_name", Value: lastName },
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      }),
    );
    console.log("User created, now creating/adding to group");
  } catch (error) {
    if (error.name === "UsernameExistsException") {
      console.log(`User '${email}' already exists in admin userpool`);
      userAlreadyExists = true;
    } else {
      throw error;
    }
  }

  // 2. If user already existed, check if they have a higher-privilege role
  //    that already covers this tenant — if so, skip TA_ group assignment
  if (userAlreadyExists) {
    try {
      const groupsResult = await cognito.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: userPoolId,
          Username: email,
        }),
      );

      const userGroups = (groupsResult.Groups || []).map((g) => g.GroupName);
      console.log(`User '${email}' current groups:`, userGroups);

      const isSA = userGroups.includes("SA");
      const isSPAForThisOrg = orgId && userGroups.includes(`SPA_${orgId}`);

      if (isSA) {
        console.log(`User '${email}' is SA (Super Admin), skipping TA_${tenantId} assignment`);
        return;
      }

      if (isSPAForThisOrg) {
        console.log(`User '${email}' is SPA_${orgId} (IT Svc Org Admin for this tenant's org), skipping TA_${tenantId} assignment`);
        return;
      }

      console.log(`User '${email}' does not have SA or SPA_${orgId} role, proceeding to add TA_${tenantId}`);
    } catch (listError) {
      console.warn(`Failed to list groups for user '${email}' (non-fatal, will proceed to add group):`, listError.message);
      // Proceed to add group anyway — better to have a redundant group than miss it
    }
  }

  // 3. Create TA group if doesn't exist
  const groupName = `TA_${tenantId}`;

  try {
    await cognito.send(
      new CreateGroupCommand({
        GroupName: groupName,
        UserPoolId: userPoolId,
        Description: `Tenant Admin for ${tenantId}`,
      }),
    );
    console.log(`Created group: ${groupName}`);
  } catch (error) {
    if (error.name === "GroupExistsException") {
      console.log(`Group already exists: ${groupName}`);
    } else {
      throw error;
    }
  }

  // 4. Add user to group
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: email,
      GroupName: groupName,
    }),
  );

  console.log(`User ${email} added to group ${groupName}`);
}

export default createTenant;
