//AWS configurations
import { ScanCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { validateTenantAccess, getTenantIdFromRequest, createResponse } from 'admin-auth';
import postResData from "./post.mjs";

const dynamoDBClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event) => {
  console.info("EVENT\n" + JSON.stringify(event, null, 2));

  let errMsg = { type: "exception", message: "Service Error" };

  try {
    // 1. Extract tenant_id from request (X-Tenant-Id header)
    const tenantId = getTenantIdFromRequest(event);
    if (!tenantId) {
      return createResponse(400, { error: 'tenant_id required in request' });
    }

    // 2. Validate authorization and get tenant's user pool ID
    const authResult = await validateTenantAccess(event, tenantId);
    if (!authResult.authorized) {
      return createResponse(authResult.statusCode, { error: authResult.error });
    }

    const { userPoolId } = authResult;
    const importJobTable = `amfa-importjobid-${tenantId}`;
    console.log(`Authorized access for tenant ${tenantId}, userPoolId: ${userPoolId}, importJobTable: ${importJobTable}`);

    if (
      event.requestContext.http.method === "POST" &&
      (!event.queryStringParameters || !event.queryStringParameters.page)
    ) {
      // import users — pass dynamic userPoolId and tenantId
      const body = JSON.parse(event.body);
      console.log("POST data: ", body);
      const postResult = await postResData(
        body,
        userPoolId,
        tenantId,
        dynamoDBClient,
        s3Client,
        importJobTable,
      );
      return postResult;
    } else {
      // get all user import jobs info from dynamodb
      console.log("GET data: ", event.queryStringParameters);

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
              "Content-Type,Authorization,X-Api-Key,X-Tenant-Id,Content-Range,X-Requested-With",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
            "Access-Control-Expose-Headers": "Content-Range",
            "Content-Range": `importuserslist ${start}-${start}/${0}`,
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

      let PaginationToken = null;

      if (
        event.queryStringParameters &&
        event.queryStringParameters.page &&
        parseInt(event.queryStringParameters.page) > 1 &&
        event.body
      ) {
        PaginationToken = event.body;
      }

      // scan dynamodb by userPoolId (dynamic, from tenant resolution)
      const FilterExpression = "userpoolid = :userpoolId";
      const ExpressionAttributeValues = {
        ":userpoolId": { S: userPoolId },
      };

      let resData = [];

      do {
        const scanParams = {
          TableName: importJobTable,
          ConsistentRead: true,
          ...(PaginationToken && { ExclusiveStartKey: PaginationToken }),
          FilterExpression,
          ExpressionAttributeValues,
          Limit: 1000,
          ReturnConsumedCapacity: "NONE",
        };

        console.info("scanParams", scanParams);

        const listImportUsersJobData = await dynamoDBClient.send(
          new ScanCommand(scanParams),
        );
        console.log("listUserImportJobs result", listImportUsersJobData);

        if (
          listImportUsersJobData.Items &&
          listImportUsersJobData.Items.length > 0
        ) {
          PaginationToken = listImportUsersJobData.LastEvaluatedKey;
          resData = resData.concat(listImportUsersJobData.Items);
        } else {
          PaginationToken = null;
        }
      } while (PaginationToken && resData.length < 1000);

      const page = parseInt(event.queryStringParameters.page);
      const perPage = parseInt(event.queryStringParameters.perPage);

      if (resData && resData.length > 0) {
        resData.sort((a, b) => {
          if (a.timestamp.N > b.timestamp.N) return -1;
          else return 1;
        });
      } else {
        resData = [];
      }

      const start = (page - 1) * perPage;
      const end =
        resData.length > start + perPage ? start + perPage : resData.length;
      const jobsCount = resData.length;

      console.log(
        "start",
        start,
        "end",
        end,
        "page",
        page,
        "perPage",
        perPage,
        "resData.length",
        resData.length,
      );

      PaginationToken = end >= resData.length ? null : end;

      if (resData.length > start) {
        resData = resData.slice(start, end);
      }
      console.log("resData", resData);

      for (let i = 0; i < resData.length; i++) {
        const params = {
          Bucket: process.env.IMPORTUSERS_BUCKET,
          Key: `jobs/${resData[i].jobid.S}_result`,
        };
        const command = new GetObjectCommand(params);
        try {
          const response = await s3Client.send(command);
          const body = await response.Body.transformToString();
          if (body) {
            resData[i].failedusers = {};
            resData[i].failedusers.S = body;
          }
        }
        catch (e) {
          console.log("error", e);
        }
      }

      let res = [];

      if (resData.length > 0) {
        res = resData.map((item) => {
          let data = {};

          data.id = item.jobid.S;
          data.JobId = item.jobid.S;
          data.CreationDate = new Date(
            parseInt(item.timestamp.N),
          ).toUTCString();
          if (item.completiondate) {
            data.CompletionDate = new Date(
              parseInt(item.completiondate.N),
            ).toUTCString();
          }
          data.Status = item.jobstatus.S;

          if (item.failedusers) {
            let failedUsersNumber = 0;
            let FailureDetails = [];
            try {
              JSON.parse(item.failedusers.S).map((el) => {
                failedUsersNumber++;
                FailureDetails.push(el);
              });
            } catch (e) {
              console.log("failedusers parse error: ", e);
            }
            data.FailedUsers = failedUsersNumber;
          }
          if (item.totalusers) {
            data.TotalUsers = parseInt(item.totalusers.N);
          }
          data.CreatedBy = item.createdby.S;
          return data;
        });
      }

      console.log("list user import jobs resData", res);

      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Headers":
            "Content-Type,Authorization,X-Api-Key,X-Tenant-Id,Content-Range,X-Requested-With",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
          "Access-Control-Expose-Headers": "Content-Range",
          "Content-Range": `users ${start + 1}-${end}/${jobsCount}`,
        },
        body: JSON.stringify({
          data: res,
          pageInfo: {
            hasPreviousPage: page > 1 ? true : false,
            hasNextPage: PaginationToken ? true : false,
          },
          PaginationToken,
          total: jobsCount,
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

  const response = {
    statusCode: 500,
    headers: {
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Api-Key,X-Tenant-Id,Content-Range,X-Requested-With",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
      "Access-Control-Expose-Headers": "Content-Range",
    },
    body: JSON.stringify(errMsg),
  };
  return response;
};