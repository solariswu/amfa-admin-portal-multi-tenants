import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  listOrganizations,
  createOrganization,
  getOrganization,
  updateOrganization,
  deleteOrganization,
} from "./crud.mjs";

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE_NAME = `amfa-${process.env.ACCOUNT_ID}-${process.env.AWS_REGION}-tenanttable`;

/**
 * Extract user information from JWT token
 */
function extractUserInfo(authHeader) {
  if (!authHeader) return null;

  try {
    const jwt = authHeader.replace("Bearer ", "");
    const jwtBase64Url = jwt.split(".")[1];
    const jwtBase64 = jwtBase64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jwtBuffer = Buffer.from(jwtBase64, "base64");
    const payload = JSON.parse(jwtBuffer.toString("ascii"));

    // Get groups
    let groups = payload["cognito:groups"] || [];
    if (typeof groups === "string") {
      groups = groups.match(/[^\[\]\s]+/g) || [];
    }

    // Check if SA
    const isSA = groups.includes("SA");

    return {
      email: payload.email || "unknown",
      name: payload.given_name || payload.email || "unknown",
      groups,
      isSA,
    };
  } catch (error) {
    console.error("Failed to parse JWT:", error);
    return null;
  }
}

/**
 * Lambda handler for organizations API
 */
export const handler = async (event) => {
  console.log("EVENT:", JSON.stringify(event, null, 2));

  const method = event.requestContext.http.method;
  const authHeader =
    event.headers?.authorization || event.headers?.Authorization;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
    "Content-Type": "application/json",
  };

  try {
    // Extract user info
    const userInfo = extractUserInfo(authHeader);

    if (!userInfo) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({
          type: "error",
          message: "Unauthorized - Invalid or missing token",
        }),
      };
    }

    // LIST organizations (POST with query params, consistent with other resources)
    if (method === "POST" && event.queryStringParameters?.page) {
      console.log("Listing organizations");

      const orgs = await listOrganizations(dynamodb, TABLE_NAME);

      // Pagination info for react-admin
      const page = parseInt(event.queryStringParameters.page) || 1;
      const perPage = parseInt(event.queryStringParameters.perPage) || 25;
      const start = (page - 1) * perPage;
      const end = Math.min(start + perPage - 1, orgs.length - 1);

      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          "Content-Range": `organizations ${start}-${end}/${orgs.length}`,
        },
        body: JSON.stringify({
          data: orgs,
          total: orgs.length,
        }),
      };
    }

    // GET single organization
    if (method === "GET" && event.pathParameters?.id) {
      console.log("Getting organization:", event.pathParameters.id);

      const org = await getOrganization(
        event.pathParameters.id,
        dynamodb,
        TABLE_NAME,
      );

      if (!org) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            type: "error",
            message: "Organization not found",
          }),
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ data: org }),
      };
    }

    // CREATE organization (SA only)
    if (method === "POST") {
      console.log("Creating organization");

      if (!userInfo.isSA) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({
            type: "error",
            message: "Only Super Admins can create organizations",
          }),
        };
      }

      const body = JSON.parse(event.body);
      const org = await createOrganization(
        body.data || body,
        userInfo.email,
        userInfo.name,
        dynamodb,
        TABLE_NAME,
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ data: org }),
      };
    }

    // UPDATE organization (SA only)
    if (method === "PUT" && event.pathParameters?.id) {
      console.log("Updating organization:", event.pathParameters.id);

      if (!userInfo.isSA) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({
            type: "error",
            message: "Only Super Admins can update organizations",
          }),
        };
      }

      const body = JSON.parse(event.body);
      const updatedOrg = await updateOrganization(
        event.pathParameters.id,
        body.data || body,
        dynamodb,
        TABLE_NAME,
      );

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ data: updatedOrg }),
      };
    }

    // DELETE organization (SA only)
    if (method === "DELETE" && event.pathParameters?.id) {
      console.log("Deleting organization:", event.pathParameters.id);

      if (!userInfo.isSA) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({
            type: "error",
            message: "Only Super Admins can delete organizations",
          }),
        };
      }

      await deleteOrganization(event.pathParameters.id, dynamodb, TABLE_NAME);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          data: { id: event.pathParameters.id },
        }),
      };
    }

    // Method not supported
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        type: "error",
        message: "Invalid request",
      }),
    };
  } catch (error) {
    console.error("Error:", error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        type: "error",
        message: error.message || "Internal server error",
      }),
    };
  }
};
