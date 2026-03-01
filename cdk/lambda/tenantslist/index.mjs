import { createTenant } from "./create-tenant.mjs";

//AWS configurations
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

// Decode JWT payload
const decodeJwtPayload = (authHeader) => {
  if (!authHeader) return null;

  try {
    const jwt = authHeader.replace("Bearer ", "");
    const jwtBase64Url = jwt.split(".")[1];
    const jwtBase64 = jwtBase64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jwtBuffer = Buffer.from(jwtBase64, "base64");
    return JSON.parse(jwtBuffer.toString("ascii"));
  } catch (error) {
    console.error("Error decoding JWT:", error);
    return null;
  }
};

// Extract requester roles from JWT
const extractRequesterRoles = (authHeader) => {
  const jwtPayload = decodeJwtPayload(authHeader);
  if (!jwtPayload) return [];

  try {
    let groups = jwtPayload["cognito:groups"];
    if (!groups) return [];
    if (typeof groups === "string") groups = groups.match(/[^\[\]\s]+/g);

    return Array.isArray(groups) ? groups : [];
  } catch (error) {
    console.error("Error extracting roles from JWT:", error);
    return [];
  }
};

// Extract requester email from JWT
const extractRequesterEmail = (authHeader) => {
  const jwtPayload = decodeJwtPayload(authHeader);
  if (!jwtPayload) return null;

  return jwtPayload.email || null;
};

// Extract role info (SA or SPA with orgId)
const extractRoleInfo = (requesterRoles) => {
  if (requesterRoles.includes("SA")) {
    return { role: "SA", orgId: null };
  }

  const spaRole = requesterRoles.find((role) => role.startsWith("SPA_"));
  if (spaRole) {
    return { role: "SPA", orgId: spaRole.substring(4) };
  }

  return { role: null, orgId: null };
};

// Filter tenants based on requester role and org_id
const filterTenantsByRole = (tenants, requesterRoles) => {
  console.log("Filtering tenants by role:", {
    totalTenants: tenants.length,
    requesterRoles,
  });

  if (!requesterRoles || requesterRoles.length === 0) {
    console.log("No roles found, returning empty list");
    return [];
  }

  // SA can see all tenants
  if (requesterRoles.includes("SA")) {
    console.log("SA role - returning all tenants");
    return tenants;
  }

  // SPA_xxx can only see tenants in their org
  const spaRole = requesterRoles.find((role) => role.startsWith("SPA_"));
  if (spaRole) {
    const orgId = spaRole.substring(4); // Extract org from SPA_default
    console.log(`${spaRole} role - filtering for org_id: ${orgId}`);
    const filtered = tenants.filter((tenant) => tenant.org_id === orgId);
    console.log(`Filtered to ${filtered.length} tenants`);
    return filtered;
  }

  // TA_xxx cannot see tenant list
  console.log("TA role - returning empty list");
  return [];
};

export const handler = async (event) => {
  console.info("EVENT\n" + JSON.stringify(event, null, 2));

  let errMsg = { type: "exception", message: "Service Error" };

  try {
    if (
      event.requestContext.http.method === "POST" &&
      (!event.queryStringParameters || !event.queryStringParameters.page)
    ) {
      // Create new tenant using provision-tenant Lambda
      try {
        const authHeader =
          event.headers?.authorization || event.headers?.Authorization;
        const requesterRoles = extractRequesterRoles(authHeader);
        const { role, orgId } = extractRoleInfo(requesterRoles);

        const requesterEmail = extractRequesterEmail(authHeader);

        const body = JSON.parse(event.body);
        console.log("POST tenant data:", body.data);
        console.log("Requester role:", role, "orgId:", orgId, "requesterEmail:", requesterEmail);

        // Create tenant (invokes provision-tenant Lambda + creates admin if needed)
        const result = await createTenant(body.data.data, role, orgId, requesterEmail);

        return {
          statusCode: 200,
          headers: {
            "Access-Control-Allow-Headers":
              "Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ data: result }),
        };
      } catch (error) {
        console.error("Create tenant error:", error);

        // Preserve status code from provision-tenant Lambda (e.g., 409 for duplicates)
        let statusCode = error.status || error.statusCode || 500;
        
        // Override with 403 for permission errors
        if (error.message.includes("permissions") || error.message.includes("only")) {
          statusCode = 403;
        }

        return {
          statusCode,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "error",
            message: error.message,
            ...(error.body && { details: error.body })
          }),
        };
      }
    } else {
      // List tenants - with org-based filtering
      let NextToken = event.body ? event.body : "";

      const params = {
        ConsistentRead: true,
        ReturnConsumedCapacity: "TOTAL",
        TableName: `amfa-tenanttable`,
        FilterExpression: "#type = :type AND #status = :status",
        ExpressionAttributeNames: {
          "#type": "type",
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":type": { S: "tenant" },
          ":status": { S: "active" }
        }
      };

      console.info("params", params);

      let data = await dynamodb.send(new ScanCommand(params));
      NextToken = data.LastEvaluatedKey;

      let resData = [];
      console.log("fetched data:", data);
      if (data && data.Items && data.Items.length > 0) {
        resData = data.Items.map((item) => {
          // Remove TENANT# prefix from id
          const tenantId = item.id.S.replace('TENANT#', '');
          return {
            id: tenantId,
            name: decodeURIComponent(item.name.S),
            contact: item.contact.S,
            url: item.url.S,
            endUserSpUrl: item.endUserSpUrl.S,
            samlproxy: item.samlproxy?.BOOL,
            org_id: item.org_id?.S || "default", // Include org_id, default to 'default'
          };
        });
      }

      // Extract requester roles and filter tenants
      const authHeader =
        event.headers?.authorization || event.headers?.Authorization;
      const requesterRoles = extractRequesterRoles(authHeader);
      resData = filterTenantsByRole(resData, requesterRoles);

      // Apply request-level filters (e.g., org_id filter from UI)
      if (event.queryStringParameters?.filter) {
        try {
          const filter = JSON.parse(event.queryStringParameters.filter);
          if (filter.org_id) {
            console.log(`Applying org_id filter: ${filter.org_id}`);
            resData = resData.filter(t => t.org_id === filter.org_id);
            console.log(`After org_id filter: ${resData.length} tenants`);
          }
          if (filter.q) {
            const searchTerm = filter.q.toLowerCase();
            console.log(`Applying search filter: ${searchTerm}`);
            resData = resData.filter(t =>
              t.name?.toLowerCase().includes(searchTerm) ||
              t.id?.toLowerCase().includes(searchTerm) ||
              t.contact?.toLowerCase().includes(searchTerm)
            );
            console.log(`After search filter: ${resData.length} tenants`);
          }
        } catch (filterError) {
          console.error('Error parsing filter parameter:', filterError);
        }
      }

      // getList of React-admin expects response to have header called 'Content-Range'.
      // when we add new header in response, we have to acknowledge it, so 'Access-Control-Expose-Headers'
      const page = parseInt(event.queryStringParameters.page);
      const perPage = parseInt(event.queryStringParameters.perPage);
      const start = (page - 1) * perPage;
      const end = resData.length + start - 1;
      resData.sort((a, b) => {
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
      });

      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Headers":
            "Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
          "Access-Control-Expose-Headers": "Content-Range",
          "Content-Range": `groups ${start}-${end}`,
        },
        body: JSON.stringify({
          data: resData,
          total: resData.length,
          ...(NextToken && { PaginationToken: NextToken }),
        }),
      };
    }
  } catch (e) {
    console.log("Catch an error: ", e);
    switch (e.name) {
      case "ThrottlingException":
        errMsg = { type: "exception", message: "Too many requests" };
        break;
      case "InvalidParameterValue":
      case "InvalidParameterException":
        errMsg = { type: "exception", message: "Invalid parameter" };
        break;
      default:
        errMsg = { type: "exception", message: "Service Error" };
        break;
    }
  }
  // TODO implement
  const response = {
    statusCode: 500,
    body: JSON.stringify(errMsg),
  };
  return response;
};
