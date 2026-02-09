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
 * @returns {Object} Created tenant data
 */
export async function createTenant(data, requesterRole, requesterOrgId) {
  console.log("Creating tenant:", { data, requesterRole, requesterOrgId });

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
  const tableName = `amfa-${process.env.AWS_ACCOUNT_ID}-${process.env.AWS_REGION}-tenanttable`;
  const org = await getOrganization(data.orgId, dynamodb, tableName);

  if (!org) {
    throw new Error(
      `Organization '${data.orgId}' does not exist. Please create it first.`,
    );
  }

  console.log("Organization validated:", org);

  // 4. Invoke provision-tenant Lambda
  console.log("Invoking provision-tenant Lambda...");

  const provisionPayload = {
    body: {
      tenantId: data.tenantId,
      tenantName: data.tenantName,
      orgId: data.orgId,
      contactEmail: data.contactEmail,
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
    throw new Error(errorBody.message || "Tenant provisioning failed");
  }

  const provisionedTenant =
    typeof responsePayload.body === "string"
      ? JSON.parse(responsePayload.body)
      : responsePayload.body;

  console.log("Tenant provisioned successfully:", provisionedTenant);

  // 5. Create admin user if provided (SA only)
  if (
    requesterRole === "SA" &&
    data.adminEmail &&
    provisionedTenant.userPoolId
  ) {
    try {
      console.log("Creating admin user:", data.adminEmail);

      await createAdminUser(
        provisionedTenant.userPoolId,
        data.adminEmail,
        data.adminFirstName || "",
        data.adminLastName || "",
        data.orgId,
      );

      console.log(`Admin user created successfully: ${data.adminEmail}`);
    } catch (error) {
      console.error("Failed to create admin user (non-fatal):", error);
      // Don't fail the whole operation - tenant was created successfully
      // Just log the error
    }
  }

  return provisionedTenant;
}

/**
 * Create admin user in tenant's UserPool and add to SPA_<orgId> group
 *
 * @param {string} userPoolId - Cognito UserPool ID
 * @param {string} email - Admin email
 * @param {string} firstName - Admin first name
 * @param {string} lastName - Admin last name
 * @param {string} orgId - Organization ID
 */
async function createAdminUser(userPoolId, email, firstName, lastName, orgId) {
  console.log("Creating admin user in UserPool:", { userPoolId, email, orgId });

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

  // 2. Create SPA group if doesn't exist
  const groupName = `SPA_${orgId}`;

  try {
    await cognito.send(
      new CreateGroupCommand({
        GroupName: groupName,
        UserPoolId: userPoolId,
        Description: `Service Provider Admin for ${orgId}`,
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
