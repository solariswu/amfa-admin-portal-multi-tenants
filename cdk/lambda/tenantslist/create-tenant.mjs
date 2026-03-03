import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
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
 * Create admin user in tenant's UserPool and add to TA_<tenantId> group
 *
 * @param {string} userPoolId - Cognito UserPool ID
 * @param {string} email - Admin email
 * @param {string} firstName - Admin first name
 * @param {string} lastName - Admin last name
 * @param {string} tenantId - Tenant ID
 */
async function createAdminUser(
  userPoolId,
  email,
  firstName,
  lastName,
  tenantId,
) {
  console.log("Creating admin user in UserPool:", {
    userPoolId,
    email,
    tenantId,
  });

  // 1. Create user
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

  // 2. Create TA group if doesn't exist
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

  // 3. Add user to group
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
