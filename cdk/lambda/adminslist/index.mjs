//AWS configurations

import {
  DescribeUserPoolCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import postResData from "./post.mjs";
import getResData from "./get.mjs";

const cognitoISP = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

export const handler = async (event) => {
  console.info("EVENT\n" + JSON.stringify(event, null, 2));

  //To get the list of Users in aws Cognito
  let params = {};
  let filter = {};
  let filterString = "";

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
      let PaginationToken = null;

      if (
        event.queryStringParameters &&
        event.queryStringParameters.page &&
        parseInt(event.queryStringParameters.page) > 1 &&
        event.body
      ) {
        PaginationToken = event.body;
      }

      if (
        event.queryStringParameters &&
        event.queryStringParameters.page &&
        parseInt(event.queryStringParameters.page) > 1 &&
        !event.body
      ) {
        const start =
          (parseInt(event.queryStringParameters.page) - 1) *
            parseInt(event.queryStringParameters.perPage) +
          1;
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

      let listUsersData = {};
      listUsersData.Users = [];
      let usersCount = 0;
      let usersData = null;
      let loopCount = 0;
      if (event.queryStringParameters && event.queryStringParameters.filter) {
        filter = JSON.parse(event.queryStringParameters.filter);
      }
      const limit = parseInt(event.queryStringParameters.perPage);

      if (Object.keys(filter).includes("groups")) {
        do {
          params = {
            UserPoolId: process.env.USERPOOL_ID,
            Limit: limit - listUsersData.Users.length, // Number of users to display per page
            GroupName: filter["groups"],
            ...(PaginationToken && { NextToken: PaginationToken }),
          };

          usersData = await cognitoISP.send(
            new ListUsersInGroupCommand(params),
          );
          listUsersData.Users = listUsersData.Users
            ? [...listUsersData.Users, ...usersData.Users]
            : usersData.Users;
          PaginationToken = usersData.NextToken;
          if (usersData?.Users.length > 0) {
            loopCount = 0
          }
          else  {
            loopCount ++;
          }
        } while (
          PaginationToken &&
          loopCount < 20 &&
          limit - listUsersData.Users.length > 0
        );
        usersCount = listUsersData.Users.length;
      } else {
        // Get total count of user
        const describeData = await cognitoISP.send(
          new DescribeUserPoolCommand({
            UserPoolId: process.env.USERPOOL_ID,
          }),
        );
        console.log("describeUserpool result", describeData);
        usersCount = describeData.UserPool.EstimatedNumberOfUsers;

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
        //Saving the Pagination token for each page in obj

        do {
          params = {
            UserPoolId: process.env.USERPOOL_ID,
            Limit: limit - listUsersData.Users.length, // No of users to display per page
            ...(PaginationToken && { PaginationToken: PaginationToken }), // tokens[1] contain the token query for page 1.
            ...(filterString && { Filter: filterString }),
          };

          console.info("params", params);

          usersData = await cognitoISP.send(new ListUsersCommand(params));
          console.log("listUser result", usersData.Users);
          listUsersData.Users = listUsersData.Users
            ? [...listUsersData.Users, ...usersData.Users]
            : usersData.Users;
          // If no remaining users are there, no paginationToken is returned from cognito
          PaginationToken = usersData.PaginationToken;
          if (usersData?.Users.length > 0) {
            loopCount = 0;
          } else {
            loopCount++;
          }

          console.log(
            "usersData",
            usersData,
            "users.length",
            usersData.Users.length,
          );
          console.log(
            "listUsersData",
            listUsersData,
            "listUsersData.Users.length",
            listUsersData.Users.length,
          );
        } while (
          PaginationToken &&
          loopCount < 20 &&
          limit - listUsersData.Users.length > 0
        );
      }

      let resData = [];
      const page = parseInt(event.queryStringParameters.page);
      const perPage = parseInt(event.queryStringParameters.perPage);
      const start = (page - 1) * perPage + 1;

      try {
        const transform = async (users) => {
          return Promise.all(users.map((item) => getResData(item, cognitoISP)));
        };
        resData = await transform(listUsersData.Users);
      } catch (error) {
        // listuser error right after delete.
        // use this to avoid error in listuser response.
        console.log("err", error);
      }

      resData.sort((a, b) => {
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
      });

      const end = resData.length + start - 1;

      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Headers":
            "Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
          "Access-Control-Expose-Headers": "Content-Range",
          "Content-Range": `users ${start}-${end}/${usersCount}`,
        },
        body: JSON.stringify({
          data: resData,
          pageInfo: {
            hasPreviousPage: page > 1 ? true : false,
            hasNextPage: PaginationToken ? true : false,
          },
          PaginationToken,
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
        errMsg = { type: "exception", message: "Service Error" };
        break;
    }
  }

  // TODO implement
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
