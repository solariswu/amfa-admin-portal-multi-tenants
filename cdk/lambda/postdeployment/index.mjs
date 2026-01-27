import {
  CognitoIdentityProviderClient,
  SetUICustomizationCommand,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
  CreateIdentityProviderCommand,
  CreateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const SUIDP_NAME = "SuperUserAdmin";

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// Query DynamoDB for current tenant list
const getTenantsFromDynamoDB = async () => {
  try {
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: process.env.AMFATENANT_TABLE,
      }),
    );

    const tenants = result.Items || [];
    console.log(`Found ${tenants.length} tenants in DynamoDB:`, tenants);

    // Transform to expected format
    return tenants.map((tenant) => ({
      tenantId: tenant.id,
      tenantName: tenant.name || `Tenant ${tenant.id}`,
      userPoolId: tenant.userpool,
      orgId: tenant.orgId || tenant.orgid, // Support both cases
      endUserSpUrl:
        tenant.endUserSpUrl ||
        `https://login.${tenant.id}.${process.env.ROOT_DOMAIN_NAME}`,
      spPortalDomain: `login.${tenant.id}.${process.env.ROOT_DOMAIN_NAME}`,
      samlProxy: tenant.samlproxy !== undefined ? tenant.samlproxy : true,
      region: process.env.AWS_REGION || "us-east-1",
    }));
  } catch (error) {
    console.error("Failed to query tenants from DynamoDB:", error);
    return [];
  }
};

const switchUserpoolTierToLite = async (UserPoolId) => {
  try {
    const describeUserPoolRes = await cognito.send(
      new DescribeUserPoolCommand({
        UserPoolId,
      }),
    );

    console.log("describeUserPoolRes:", describeUserPoolRes);

    const userPool = describeUserPoolRes.UserPool;

    if (!userPool) {
      throw new Error("UserPool not found:", UserPoolId);
    }

    if (userPool.UserPoolTier === "LITE") {
      console.log("admin userpool tier is LITE already");
      return userPool.Domain;
    }

    userPool.UserPoolTier = "LITE";
    delete userPool.CreationDate;
    delete userPool.LastModifiedDate;
    delete userPool.EstimatedNumberOfUsers;
    delete userPool.Id;
    delete userPool.Status;

    const param = {
      UserPoolId,
      ...userPool,
    };

    await cognito.send(new UpdateUserPoolCommand(param));

    return userPool.Domain;
  } catch (error) {
    console.error("switch userpool tier failed with:", error);
    console.error("RequestId: " + error.requestId);
  }

  return null;
};

const customiseUserpoolLogin = async (UserPoolId, ClientId) => {
  try {
    const logo_url =
      "https://downloads.apersona.com/downloads/aPersona_Logos_Package/aPLogo-370x67.png";
    const response = await fetch(logo_url);
    const buf = await response.arrayBuffer();

    const res = await cognito.send(
      new SetUICustomizationCommand({
        UserPoolId,
        ClientId,
        ImageFile: Buffer.from(buf), //blob,
      }),
    );

    console.log("set ui customization res:", res);
  } catch (error) {
    console.error("set ui customization failed with:", error);
    console.error("RequestId: " + error.requestId);
  }
};

const addSAMLProxyCallBacks = async () => {
  try {
    const res = await cognito.send(
      new DescribeUserPoolClientCommand({
        UserPoolId: process.env.USERPOOL_ID,
        ClientId: process.env.SAML_CLIENT_ID,
      }),
    );

    console.log("describe enduser pool client result:", res);

    let params = res.UserPoolClient;
    delete params.CreationDate;
    delete params.LastModifiedDate;
    delete params.ClientSecret;
    params.CallbackURLs.push(`${process.env.SAML_CALLBACK_URL}`);

    const response = await cognito.send(
      new UpdateUserPoolClientCommand(params),
    );

    console.log("update enduser poolclient result:", response);
  } catch (error) {
    console.error("describe user pool client failed with:", error);
    console.error("RequestId: " + error.requestId);
  }
};

const addSUIdPToAdminPool = async (UserPoolId, ClientId, IdPName) => {
  try {
    const res = await cognito.send(
      new DescribeUserPoolClientCommand({
        UserPoolId,
        ClientId,
      }),
    );

    let params = res.UserPoolClient;
    delete params.CreationDate;
    delete params.LastModifiedDate;
    delete params.ClientSecret;
    params.SupportedIdentityProviders.push(IdPName);

    const response = await cognito.send(
      new UpdateUserPoolClientCommand(params),
    );

    console.log("add SU Admin IdP to AdminPool result:", response);
  } catch (error) {
    console.error("addSUIdPToAdminPool failed with:", error);
    console.error("RequestId: " + error.requestId);
  }
};

const createSUIDP = async (domainName, UserPoolId) => {
  if (domainName) {
    console.log("registering domainName to super admin api:", domainName);
    console.log("process.env.SUAPI_ENDPOINT", process.env.SUAPI_ENDPOINT);

    try {
      // fetch POST request to SUAPI ENDPOINT and get clientid client secret back
      const response = await fetch(
        `${process.env.SUAPI_ENDPOINT}/${process.env.TENANT_ID}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            domain: domainName,
            region: process.env.AWS_REGION,
            tenantId: process.env.TENANT_ID,
          }),
        },
      );
      const data = await response.json();

      console.log("register SUAPI result", data);

      console.log("params:", {
        attributes_request_method: "GET",
        client_id: data.clientId,
        client_secret: data.clientSecret,
        oidc_issuer: data.issuer,
        authorize_scopes: "openid email profile",
      });

      if (response.ok) {
        const res = await cognito.send(
          new CreateIdentityProviderCommand({
            UserPoolId,
            ProviderName: SUIDP_NAME,
            ProviderType: "OIDC",
            AttributeMapping: {
              email: "email",
              email_verified: "email_verified",
            },
            ProviderDetails: {
              attributes_request_method: "GET",
              client_id: data.clientId,
              client_secret: data.clientSecret,
              oidc_issuer: data.issuer,
              authorize_scopes: "openid email profile",
            },
          }),
        );

        console.log("create SUIDP success response:", res);
        return true;
      } else {
        console.error("failed to create SUIDP with error:", data);
      }
    } catch (error) {
      console.error("describe user pool client failed with:", error);
      console.error("RequestId: " + error.requestId);
    }
  }

  return false;
};

const createGroups = async (tenantData) => {
  // Parse tenant data if it's a string
  let tenants = [];
  if (typeof tenantData === "string") {
    try {
      tenants = JSON.parse(tenantData);
    } catch (error) {
      console.error("Failed to parse tenant data:", error);
    }
  } else if (Array.isArray(tenantData)) {
    tenants = tenantData;
  } else if (tenantData && tenantData.tenantId) {
    tenants = [tenantData];
  } else {
    console.error("Failed to find tenant data:", error);
  }

  console.log("Creating groups for tenants:", tenants);

  // Create base SA group
  const baseGroups = ["SA"];
  
  // Create tenant-specific groups (TA_<tenantId>)
  const tenantGroups = tenants.map((tenant) => `TA_${tenant.tenantId}`);
  
  // Create org-specific groups (SPA_<orgId>) from unique orgIds
  const uniqueOrgIds = [...new Set(
    tenants
      .map((tenant) => tenant.orgId)
      .filter((orgId) => orgId) // Filter out null/undefined
  )];
  
  const orgGroups = uniqueOrgIds.map((orgId) => `SPA_${orgId}`);
  
  // If there are tenants without orgId, create SPA_default as fallback
  const hasTenantsWithoutOrgId = tenants.some((tenant) => !tenant.orgId);
  if (hasTenantsWithoutOrgId) {
    orgGroups.push("SPA_default");
  }

  const allGroups = [...baseGroups, ...orgGroups, ...tenantGroups];

  console.log("Groups to create:", allGroups);
  console.log(`- Base groups: ${baseGroups.join(", ")}`);
  console.log(`- Org groups (${orgGroups.length}): ${orgGroups.join(", ")}`);
  console.log(`- Tenant groups (${tenantGroups.length}): ${tenantGroups.join(", ")}`);

  const promises = allGroups.map((group) =>
    cognito.send(
      new CreateGroupCommand({
        UserPoolId: process.env.ADMINPOOL_ID,
        GroupName: group,
      }),
    ),
  );

  const results = await Promise.allSettled(promises);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `create group ${allGroups[index]} failed with:`,
        result.reason,
      );
      console.error("RequestId: " + result.reason.requestId);
    } else {
      console.log(`Successfully created group: ${allGroups[index]}`);
    }
  });
};

export const handler = async (event) => {
  console.log(
    "Post deployment handler started with event:",
    JSON.stringify(event, null, 2),
  );

  const adminPoolDomainName = await switchUserpoolTierToLite(
    process.env.ADMINPOOL_ID,
  );

  // Query DynamoDB for current tenant list
  const tenantData = await getTenantsFromDynamoDB();
  console.log("Tenant data from DynamoDB:", tenantData);

  const results = await Promise.allSettled([
    customiseUserpoolLogin(process.env.ADMINPOOL_ID, process.env.CLIENT_ID),
    addSAMLProxyCallBacks(),
    createGroups(tenantData),
    createSUIDP(adminPoolDomainName, process.env.ADMINPOOL_ID),
  ]);

  results.forEach((result, index) => {
    const operations = [
      "customiseUserpoolLogin",
      "addSAMLProxyCallBacks",
      "createGroups",
      "createSUIDP",
    ];
    if (result.status === "rejected") {
      console.error(`${operations[index]} failed with:`, result.reason);
      console.error("RequestId: " + result.reason.requestId);
    } else {
      console.log(`${operations[index]} completed successfully`);
    }
  });

  await addSUIdPToAdminPool(
    process.env.ADMINPOOL_ID,
    process.env.CLIENT_ID,
    SUIDP_NAME,
  );

  console.log("post deployment success");
};
