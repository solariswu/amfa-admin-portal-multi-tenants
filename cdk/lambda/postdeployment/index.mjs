import {
  CognitoIdentityProviderClient,
  SetUICustomizationCommand,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
  CreateGroupCommand,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

/**
 * Switch admin userpool to LITE tier (cost optimization).
 */
const switchUserpoolTierToLite = async (userPoolId) => {
  try {
    const { UserPool: userPool } = await cognito.send(
      new DescribeUserPoolCommand({ UserPoolId: userPoolId }),
    );

    if (!userPool) {
      throw new Error(`UserPool not found: ${userPoolId}`);
    }

    if (userPool.UserPoolTier === "LITE") {
      console.log("Admin userpool tier is LITE already");
      return;
    }

    // Clean up read-only fields before update
    const { CreationDate, LastModifiedDate, EstimatedNumberOfUsers, Id, Status, ...updateParams } = userPool;

    await cognito.send(
      new UpdateUserPoolCommand({
        UserPoolId: userPoolId,
        ...updateParams,
        UserPoolTier: "LITE",
      }),
    );
    console.log("✓ Admin userpool switched to LITE tier");
  } catch (error) {
    console.error("Failed to switch userpool tier:", error.message);
  }
};

/**
 * Customize the Cognito hosted UI login page with aPersona logo.
 */
const customiseUserpoolLogin = async (userPoolId, clientId) => {
  try {
    const logoUrl = "https://downloads.apersona.com/downloads/aPersona_Logos_Package/aPLogo-370x67.png";
    const response = await fetch(logoUrl);
    const buf = await response.arrayBuffer();

    await cognito.send(
      new SetUICustomizationCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
        ImageFile: Buffer.from(buf),
      }),
    );
    console.log("✓ Userpool login UI customized with logo");
  } catch (error) {
    console.error("Failed to customize login UI:", error.message);
  }
};

/**
 * Create the SA (Super Admin) group in the admin userpool.
 * Idempotent — handles GroupExistsException gracefully.
 * SPA_ and TA_ groups are created during org/tenant creation, not here.
 */
const createSAGroup = async (userPoolId) => {
  try {
    await cognito.send(
      new CreateGroupCommand({
        UserPoolId: userPoolId,
        GroupName: "SA",
        Description: "Super Admin group",
      }),
    );
    console.log("✓ SA group created");
  } catch (error) {
    if (error.name === "GroupExistsException") {
      console.log("✓ SA group already exists");
    } else {
      console.error("Failed to create SA group:", error.message);
      throw error;
    }
  }
};

/**
 * Create the initial Super Admin user.
 * Idempotent — handles UsernameExistsException gracefully.
 */
const createAdminUser = async (userPoolId, adminEmail) => {
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: adminEmail,
        UserAttributes: [
          { Name: "email", Value: adminEmail },
          { Name: "email_verified", Value: "true" },
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      }),
    );
    console.log(`✓ Admin user created: ${adminEmail}`);
  } catch (error) {
    if (error.name === "UsernameExistsException") {
      console.log(`✓ Admin user already exists: ${adminEmail}`);
    } else {
      console.error(`Failed to create admin user: ${error.message}`);
      throw error;
    }
  }
};

/**
 * Assign the admin user to the SA group.
 * Must be called after both createSAGroup and createAdminUser complete.
 */
const assignAdminToSAGroup = async (userPoolId, adminEmail) => {
  try {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: adminEmail,
        GroupName: "SA",
      }),
    );
    console.log(`✓ Admin user assigned to SA group: ${adminEmail}`);
  } catch (error) {
    console.error(`Failed to assign admin to SA group: ${error.message}`);
    // Non-fatal — user and group were created, assignment can be retried
  }
};

export const handler = async (event) => {
  console.log("Post deployment handler started:", JSON.stringify(event, null, 2));

  const userPoolId = process.env.ADMINPOOL_ID;
  const clientId = process.env.CLIENT_ID;
  const adminEmail = process.env.ADMIN_EMAIL;

  // Step 1: Switch userpool tier (must complete before UI customization)
  await switchUserpoolTierToLite(userPoolId);

  // Step 2: Run independent tasks in parallel
  //   - Customize login UI
  //   - Create SA group
  //   - Create admin user (if configured)
  const parallelTasks = [
    customiseUserpoolLogin(userPoolId, clientId),
    createSAGroup(userPoolId),
  ];

  const hasAdminEmail = adminEmail && adminEmail !== "admin@example.com";
  if (hasAdminEmail) {
    parallelTasks.push(createAdminUser(userPoolId, adminEmail));
  }

  const results = await Promise.allSettled(parallelTasks);
  const taskNames = hasAdminEmail
    ? ["customiseUserpoolLogin", "createSAGroup", "createAdminUser"]
    : ["customiseUserpoolLogin", "createSAGroup"];

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`${taskNames[index]} failed:`, result.reason?.message || result.reason);
    }
  });

  // Step 3: Assign admin to SA group (after both group and user exist)
  if (hasAdminEmail) {
    await assignAdminToSAGroup(userPoolId, adminEmail);
  }

  console.log("Post deployment completed successfully");
};