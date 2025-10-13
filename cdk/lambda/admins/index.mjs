import { putResData } from "./put.mjs";
import { deleteResData } from "./delete.mjs";
import { getResData } from "./get.mjs";

import {
  CognitoIdentityProviderClient,
  AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// AWS configurations
const cognitoISP = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

const headers = {
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-Api-Key,X-Requested-With",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
};

// Valid role types for filtering
const VALID_ROLES = ["SA", "SPA"];
const isValidRole = (role) =>
  VALID_ROLES.includes(role) || role.startsWith("TA_");

// Get user's groups from Cognito (optimized with caching potential)
const getUserGroups = async (username) => {
  try {
    const result = await cognitoISP.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: process.env.USERPOOL_ID,
        Username: username,
        Limit: 60,
      }),
    );

    return (
      result.Groups?.map((group) => group.GroupName).filter(isValidRole) || []
    );
  } catch (error) {
    console.log("Error getting user groups:", error);
    return [];
  }
};

// RBAC validation function for admin operations (optimized)
const validateAdminOperationPermission = async (
  requesterRoles,
  operation,
  targetUsername,
) => {
  console.log("Validating admin operation permission:", {
    requesterRoles,
    operation,
    targetUsername,
  });

  if (!requesterRoles?.length) {
    return { isValid: false, error: "No requester roles provided" };
  }

  if (!targetUsername) {
    return { isValid: false, error: "No target username provided" };
  }

  // Early return for SA - can do anything
  if (requesterRoles.includes("SA")) {
    return { isValid: true };
  }

  // Get target user's groups
  const targetUserGroups = await getUserGroups(targetUsername);
  console.log("Target user groups:", targetUserGroups);

  const targetHasSA = targetUserGroups.includes("SA");
  const hasSPA = requesterRoles.includes("SPA");
  const requesterTARoles = requesterRoles.filter((role) =>
    role.startsWith("TA_"),
  );

  // SPA validation
  if (hasSPA) {
    return targetHasSA
      ? {
          isValid: false,
          error: `SPA cannot perform ${operation} operation on SA users`,
        }
      : { isValid: true };
  }

  // TA validation
  if (requesterTARoles.length > 0) {
    const hasCommonGroup = targetUserGroups.some((group) =>
      requesterTARoles.includes(group),
    );
    return hasCommonGroup
      ? { isValid: true }
      : {
          isValid: false,
          error: `TA users with roles [${requesterTARoles.join(", ")}] can only perform operations on users in their groups. Target user has groups: [${targetUserGroups.join(", ")}]`,
        };
  }

  // No valid roles found
  return {
    isValid: false,
    error: `Requester roles [${requesterRoles.join(", ")}] are not authorized to perform admin operations`,
  };
};

// Extract requester roles from JWT claims (optimized)
const extractRequesterRoles = (jwtClaims) => {
  const groups = jwtClaims?.["cognito:groups"];
  return Array.isArray(groups) ? groups.filter(isValidRole) : [];
};

// Helper function to create error responses
const createErrorResponse = (statusCode, type, message) => ({
  statusCode,
  headers,
  body: JSON.stringify({ type, message }),
});

// Helper function to create success responses
const createSuccessResponse = (data) => ({
  statusCode: 200,
  headers,
  body: JSON.stringify({ data }),
});

// Helper function to validate RBAC and return error response if invalid
const validateRBACOrReturnError = async (
  requesterRoles,
  operation,
  targetUsername,
) => {
  if (!targetUsername) return null; // Skip validation if no target username

  const validation = await validateAdminOperationPermission(
    requesterRoles,
    operation,
    targetUsername,
  );
  return validation.isValid
    ? null
    : createErrorResponse(
        403,
        "authorization_error",
        `Access Denied: ${validation.error}`,
      );
};

export const handler = async (event) => {
  console.info("EVENT\n" + JSON.stringify(event, null, 2));

  const method = event.requestContext.http.method;
  console.log("HTTP Method:", method);

  try {
    // Handle OPTIONS early
    if (method === "OPTIONS") {
      return createSuccessResponse("ok");
    }

    // Extract requester roles from JWT token
    const requesterRoles = extractRequesterRoles(
      event.requestContext.authorizer.jwt?.claims,
    );
    console.log("Requester roles:", requesterRoles);

    // Route handlers with RBAC validation
    switch (method) {
      case "GET": {
        const targetUsername = event.pathParameters?.id;
        const rbacError = await validateRBACOrReturnError(
          requesterRoles,
          "GET",
          targetUsername,
        );
        if (rbacError) return rbacError;

        const result = await getResData(targetUsername, cognitoISP);
        return createSuccessResponse(result);
      }

      case "PUT": {
        const user = JSON.parse(event.body);
        const targetUsername = user.data?.username;
        const rbacError = await validateRBACOrReturnError(
          requesterRoles,
          "PUT",
          targetUsername,
        );
        if (rbacError) return rbacError;

        const result = await putResData(user.data, cognitoISP);
        return createSuccessResponse(result);
      }

      case "DELETE": {
        const targetUsername = event.pathParameters?.id;
        const rbacError = await validateRBACOrReturnError(
          requesterRoles,
          "DELETE",
          targetUsername,
        );
        if (rbacError) return rbacError;

        const result = await deleteResData(
          event.pathParameters,
          cognitoISP,
          event.requestContext.authorizer.jwt.claims.email,
        );
        return createSuccessResponse(result);
      }

      default:
        return createErrorResponse(404, "not_found", "Not Found");
    }
  } catch (error) {
    console.log("Catch an error:", error);

    // Handle authorization errors
    if (error.message?.includes("Access Denied")) {
      return createErrorResponse(403, "authorization_error", error.message);
    }

    // Handle other errors
    return createErrorResponse(500, "exception", "Service Error");
  }
};
