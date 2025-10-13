//AWS configurations
import {
  ListGroupsCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

import postResData from "./post.mjs";

const cognitoISP = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

const Limit = 60;

// Valid role types for filtering
const VALID_ROLES = ["SA", "SPA"];
const isValidRole = (role) =>
  VALID_ROLES.includes(role) || role.startsWith("TA_");

// Extract requester roles from JWT claims
const extractRequesterRoles = (jwtClaims) => {
  const groups = jwtClaims?.["cognito:groups"];
  return Array.isArray(groups) ? groups.filter(isValidRole) : [];
};

// Filter groups based on RBAC rules
const filterGroupsByRBAC = (groups, requesterRoles) => {
  console.log("Filtering groups by RBAC:", {
    groups: groups.map((g) => g.GroupName),
    requesterRoles,
  });

  if (!requesterRoles?.length) {
    console.log("No requester roles, returning empty array");
    return [];
  }

  // SA can get all groups including SA/SPA/TA_xxx
  if (requesterRoles.includes("SA")) {
    console.log("SA user - returning all groups");
    return groups;
  }

  // SPA would not get "SA" among the groups
  if (requesterRoles.includes("SPA")) {
    const filteredGroups = groups.filter((group) => group.GroupName !== "SA");
    console.log(
      "SPA user - filtered out SA group:",
      filteredGroups.map((g) => g.GroupName),
    );
    return filteredGroups;
  }

  // TA_xxx roles requester would only get those TA_xxx groups within their own roles
  const requesterTARoles = requesterRoles.filter((role) =>
    role.startsWith("TA_"),
  );
  if (requesterTARoles.length > 0) {
    const filteredGroups = groups.filter((group) =>
      requesterTARoles.includes(group.GroupName),
    );
    console.log(
      "TA user - filtered to own groups:",
      filteredGroups.map((g) => g.GroupName),
    );
    return filteredGroups;
  }

  // No valid roles found
  console.log("No valid roles found, returning empty array");
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
      // invite new user
      const body = JSON.parse(event.body);
      console.log("POST data: ", body);
      const postResult = await postResData(body.data, cognitoISP);

      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Headers":
            "Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
          "Access-Control-Expose-Headers": "Content-Range",
          "Content-Type": "application/json",
          "Access-Control-Allow-Credentials": true,
        },
        body: JSON.stringify({ data: postResult }),
      };
    } else {
      // Extract requester roles from JWT token for RBAC
      const requesterRoles = extractRequesterRoles(
        event.requestContext.authorizer.jwt.claims,
      );
      console.log("Requester roles:", requesterRoles);

      let NextToken = event.body ? event.body : "";

      const params = {
        Limit,
        ...(event.body && { NextToken: event.body }), // tokens[1] contain the token query for page 1.
        UserPoolId: process.env.USERPOOL_ID,
      };

      console.info("params", params);

      let data = await cognitoISP.send(new ListGroupsCommand(params));
      NextToken = data.NextToken;

      // Filter out internal groups that start with UserPoolId
      const reduced = data.Groups.reduce(function (filtered, item) {
        if (
          item.GroupName.startsWith("TA_") ||
          item.GroupName === "SA" ||
          item.GroupName === "SPA"
        ) {
          filtered.push(item);
        }
        return filtered;
      }, []);

      // Apply RBAC filtering based on requester roles
      const rbacFilteredGroups = filterGroupsByRBAC(reduced, requesterRoles);

      let resData = [];
      if (rbacFilteredGroups && rbacFilteredGroups.length > 0) {
        resData = rbacFilteredGroups.map((item) => {
          return {
            id: item.GroupName,
            group: item.GroupName,
            creationDate: item.CreationDate,
            description: item.Description,
            lastModifiedDate: item.LastModifiedDate,
            precedence: item.Precedence,
          };
        });
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
