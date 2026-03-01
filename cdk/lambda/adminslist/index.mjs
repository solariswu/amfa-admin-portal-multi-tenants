//AWS configurations

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import postResData, { getAvailableTAGroupsForRole } from "./post.mjs";
import getResData from "./get.mjs";

// Import shared auth utilities from lambda layer
import {
  extractRolesFromEvent,
  prioritizeRoles,
} from "admin-auth";

const cognitoISP = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

const getUsers = async (
  userGroup,
  requiredUserNum,
  paginationToken,
  requesterRoles,
  filter = {},
) => {
  console.log(
    "getUsers w/wo group",
    userGroup,
    "amount",
    requiredUserNum,
    "pagiToken",
    paginationToken,
    "requester roles",
    requesterRoles,
  );

  let listUsersData = { Users: [] };

  // listing users with desired userGroup
  if (userGroup) {
    // only SA can list SA Users
    if (requesterRoles[0] !== "SA" && userGroup === "SA") {
      return { users: [], paginationToken: null, statusCode: 403 };
    }

    // TA and SPA_yyy can only list users in their allowed groups
    if (
      requesterRoles[0] !== "SA" &&
      !requesterRoles[0].startsWith("SPA_") &&
      !requesterRoles.includes(userGroup)
    ) {
      return { users: [], paginationToken: null, statusCode: 403 };
    }
  }

  let loopCount = 0;
  let params = {};
  let usersData = { Users: [] };

  try {
    do {
      if (userGroup) {
        params = {
          UserPoolId: process.env.USERPOOL_ID,
          Limit: requiredUserNum - listUsersData.Users.length,
          GroupName: userGroup,
          ...(paginationToken && { NextToken: paginationToken }),
        };
        usersData = await cognitoISP.send(new ListUsersInGroupCommand(params));
        console.log("listUsersInGroup result", usersData.Users);
      } else {
        let filterString = null;
        if (Object.keys(filter).includes("given_name")) {
          filterString = 'given_name ^= "' + filter["given_name"] + '"';
        }

        if (Object.keys(filter).includes("family_name")) {
          filterString = 'family_name ^= "' + filter["family_name"] + '"';
        }

        if (Object.keys(filter).includes("email")) {
          filterString = 'email ^= "' + filter["email"] + '"';
        }

        console.log("filterString", filterString);
        console.log("filter", filter);

        params = {
          UserPoolId: process.env.USERPOOL_ID,
          Limit: requiredUserNum - listUsersData.Users.length,
          ...(paginationToken && { PaginationToken: paginationToken }),
          ...(filterString && { Filter: filterString }),
        };
        usersData = await cognitoISP.send(new ListUsersCommand(params));
        console.log("listUser result", usersData.Users);
      }

      // protection of empty user list returned with pagination token
      if (usersData?.Users.length > 0) {
        loopCount = 0;
        // adding user group info into the data
        try {
          const transform = async (users) => {
            return Promise.all(
              users.map((item) => getResData(item, cognitoISP)),
            );
          };
          usersData = await transform(usersData.Users);
          usersData = { Users: usersData };
        } catch (error) {
          console.log("err", error);
        }

        if (!userGroup) {
          // filter out "SA" users when requesterRole is "SPA_yyy"
          if (requesterRoles[0].startsWith("SPA_")) {
            usersData.Users = usersData.Users.filter(
              (user) => user.groups.includes("SA") === false,
            );
          }
          // filter out users not in requester's groups when requesterRole is "TA_xxx"
          if (!requesterRoles[0].startsWith("SPA_") && requesterRoles[0] !== "SA") {
            usersData.Users = usersData.Users.filter((user) =>
              user.groups.some((group) => requesterRoles.includes(group)),
            );
          }
        }
      } else {
        loopCount++;
      }

      listUsersData.Users = listUsersData.Users
        ? [...listUsersData.Users, ...usersData.Users]
        : usersData.Users;
      paginationToken = usersData.PaginationToken;
    } while (
      paginationToken &&
      loopCount < 20 &&
      requiredUserNum - listUsersData.Users.length > 0
    );
  } catch (error) {
    console.log("listUser error", error);
    return { users: [], paginationToken: null, statusCode: 500 };
  }

  let resData = listUsersData.Users;

  resData.sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  return { users: resData, paginationToken, statusCode: 200 };
};

// Helper to extract email from JWT header
const extractEmailFromHeader = (authHeader) => {
  try {
    const jwt = authHeader;
    const jwtBase64Url = jwt.split(".")[1];
    const jwtBase64 = jwtBase64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jwtBuffer = Buffer.from(jwtBase64, "base64");
    const jwtPayload = JSON.parse(jwtBuffer.toString("ascii"));
    return jwtPayload.email || "";
  } catch (error) {
    console.log("Error extracting email from header:", error);
    return "";
  }
};

// Helper to extract and prioritize roles from JWT header
const extractRolesFromHeader = (authHeader) => {
  try {
    const jwt = authHeader;
    const jwtBase64Url = jwt.split(".")[1];
    const jwtBase64 = jwtBase64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jwtBuffer = Buffer.from(jwtBase64, "base64");
    const jwtPayload = JSON.parse(jwtBuffer.toString("ascii"));

    let requesterRoles = jwtPayload["cognito:groups"];
    if (!requesterRoles || requesterRoles.length === 0) {
      return [];
    }

    // For SA role, check identities
    if (requesterRoles.includes("SA")) {
      let saIdPs = jwtPayload["identities"];
      if (saIdPs) {
        saIdPs = saIdPs.filter(
          (identity) => identity.providerName === "SuperUserAdmin",
        );
        if (saIdPs && saIdPs.length > 0) {
          return ["SA"];
        } else {
          throw new Error("Super Admin issuer value does not match");
        }
      }
    }

    // Use prioritizeRoles from shared layer
    return prioritizeRoles(requesterRoles);
  } catch (error) {
    console.log("Error extracting roles from header:", error);
    throw error;
  }
};

export const handler = async (event) => {
  console.info("EVENT\n" + JSON.stringify(event, null, 2));

  let filter = {};
  let errMsg = { type: "exception", message: "Service Error" };

  try {
    if (
      event.requestContext.http.method === "POST" &&
      (!event.queryStringParameters || !event.queryStringParameters.page)
    ) {
      // invite new user
      const body = JSON.parse(event.body);
      console.log("POST data: ", body);

      // Extract requester roles and email from JWT for RBAC validation
      const requesterRoles = extractRolesFromHeader(event.headers["authorization"]);
      const requesterEmail = extractEmailFromHeader(event.headers["authorization"]);
      console.log("POST requester roles:", requesterRoles, "requester email:", requesterEmail);

      const postResult = await postResData(
        body.data,
        cognitoISP,
        requesterRoles,
        requesterEmail,
      );

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
      let page = 0;
      let PaginationToken = null;
      let usersAmount = 0;
      let queryGroup = null;

      if (event.queryStringParameters) {
        // Handle request for available groups
        if (event.queryStringParameters.getAvailableGroups === "true") {
          // Extract requester roles from JWT
          const requesterRoles = extractRolesFromHeader(event.headers["authorization"]);

          const availableGroups = await getAvailableTAGroupsForRole(
            requesterRoles,
            cognitoISP,
          );

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
            body: JSON.stringify({ data: availableGroups }),
          };
        }

        if (event.queryStringParameters.page) {
          page = parseInt(event.queryStringParameters.page);
        }

        if (event.queryStringParameters.perPage) {
          usersAmount = parseInt(event.queryStringParameters.perPage);
        }

        if (event.queryStringParameters.filter) {
          filter = JSON.parse(event.queryStringParameters.filter);

          if (
            Object.keys(filter).includes("groups") &&
            filter["groups"] !== ""
          ) {
            queryGroup = filter["groups"];
          }
        }
      }

      const start = (page - 1) * usersAmount + 1;

      if (page && page > 1) {
        if (event.body) {
          PaginationToken = event.body;
        } else {
          return {
            statusCode: 200,
            headers: {
              "Access-Control-Allow-Headers":
                "Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
              "Access-Control-Expose-Headers": "Content-Range",
              "Content-Range": `users ${start}-${start}/${0}`,
            },
            body: JSON.stringify({
              data: [],
              pageInfo: {
                hasPreviousPage: true,
                hasNextPage: false,
              },
              PaginationToken: null,
            }),
          };
        }
      }

      // Extract requester roles from JWT
      const requesterRoles = extractRolesFromHeader(event.headers["authorization"]);
      console.log("GET requester roles:", requesterRoles);

      const { users, paginationToken, statusCode } = await getUsers(
        queryGroup,
        usersAmount,
        PaginationToken,
        requesterRoles,
        filter,
      );

      if (statusCode !== 200) {
        return {
          statusCode: statusCode,
          headers: {
            "Access-Control-Allow-Headers":
              "Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
            "Access-Control-Expose-Headers": "Content-Range",
            "Content-Type": "application/json",
            "Access-Control-Allow-Credentials": true,
          },
          body: JSON.stringify({
            data: [],
            pageInfo: {
              hasPreviousPage: false,
              hasNextPage: false,
            },
            PaginationToken: null,
          }),
        };
      }

      console.log("getUsers successfully", users, "users.length", users.length);

      const end = users.length + start - 1;

      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Headers":
            "Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
          "Access-Control-Expose-Headers": "Content-Range",
          "Content-Range": `users ${start}-${end}/${end}`,
        },
        body: JSON.stringify({
          data: users,
          pageInfo: {
            hasPreviousPage: page > 1 ? true : false,
            hasNextPage: paginationToken ? true : false,
          },
          PaginationToken: paginationToken,
        }),
      };
    }
  } catch (e) {
    console.log("Catch an error: ", e);
    switch (e.name) {
      case "InvalidPasswordException":
        errMsg = { type: "exception", message: "Invalid Password" };
        break;
      case "UserNotFoundException":
        errMsg = { type: "exception", message: "User not found" };
        break;
      case "UserNotConfirmedException":
        errMsg = { type: "exception", message: "User not confirmed" };
        break;
      case "NotAuthorizedException":
        errMsg = { type: "exception", message: "Not authorized" };
        break;
      case "TooManyRequestsException":
        errMsg = { type: "exception", message: "Too many requests" };
        break;
      case "UsernameExistsException":
        errMsg = {
          type: "exception",
          message: "Username/email already exists",
        };
        break;
      case "InvalidParameterException":
        errMsg = { type: "exception", message: "Invalid parameter" };
        break;
      default:
        errMsg = { type: "exception", message: e.message || "Service Error" };
        break;
    }
  }

  const response = {
    statusCode: 500,
    headers: {
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
      "Access-Control-Expose-Headers": "Content-Range",
    },
    body: JSON.stringify(errMsg),
  };
  return response;
};
