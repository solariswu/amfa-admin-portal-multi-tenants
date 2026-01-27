import { putResData } from "./put.mjs";
import { deleteResData } from "./delete.mjs";
import { getResData } from "./get.mjs";

import {
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

// Import shared auth utilities from lambda layer
import {
  extractRolesFromEvent,
  validateAdminOperation,
  createAdminResponse,
} from "admin-auth";

// AWS configurations
const cognitoISP = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

export const handler = async (event) => {
  console.info("EVENT\n" + JSON.stringify(event, null, 2));

  const method = event.requestContext.http.method;
  console.log("HTTP Method:", method);

  try {
    // Handle OPTIONS early
    if (method === "OPTIONS") {
      return createAdminResponse(200, "ok");
    }

    // Extract requester roles from JWT token
    const requesterRoles = extractRolesFromEvent(event);
    console.log("Requester roles:", requesterRoles);

    // Route handlers with RBAC validation
    switch (method) {
      case "GET": {
        const targetUsername = event.pathParameters?.id;
        
        // Validate RBAC for GET operation
        if (targetUsername) {
          const validation = await validateAdminOperation(
            requesterRoles,
            "GET",
            targetUsername,
            cognitoISP,
          );
          if (!validation.isValid) {
            return createAdminResponse(403, null, {
              type: "authorization_error",
              message: `Access Denied: ${validation.error}`,
            });
          }
        }

        const result = await getResData(targetUsername, cognitoISP);
        return createAdminResponse(200, result);
      }

      case "PUT": {
        const user = JSON.parse(event.body);
        const targetUsername = user.data?.username;
        
        // Validate RBAC for PUT operation
        if (targetUsername) {
          const validation = await validateAdminOperation(
            requesterRoles,
            "PUT",
            targetUsername,
            cognitoISP,
          );
          if (!validation.isValid) {
            return createAdminResponse(403, null, {
              type: "authorization_error",
              message: `Access Denied: ${validation.error}`,
            });
          }
        }

        const result = await putResData(user.data, cognitoISP);
        return createAdminResponse(200, result);
      }

      case "DELETE": {
        const targetUsername = event.pathParameters?.id;
        
        // Validate RBAC for DELETE operation
        if (targetUsername) {
          const validation = await validateAdminOperation(
            requesterRoles,
            "DELETE",
            targetUsername,
            cognitoISP,
          );
          if (!validation.isValid) {
            return createAdminResponse(403, null, {
              type: "authorization_error",
              message: `Access Denied: ${validation.error}`,
            });
          }
        }

        const result = await deleteResData(
          event.pathParameters,
          cognitoISP,
          event.requestContext.authorizer.jwt.claims.email,
        );
        return createAdminResponse(200, result);
      }

      default:
        return createAdminResponse(404, null, {
          type: "not_found",
          message: "Not Found",
        });
    }
  } catch (error) {
    console.log("Catch an error:", error);

    // Handle authorization errors
    if (error.message?.includes("Access Denied")) {
      return createAdminResponse(403, null, {
        type: "authorization_error",
        message: error.message,
      });
    }

    // Handle other errors
    return createAdminResponse(500, null, {
      type: "exception",
      message: "Service Error",
    });
  }
};
