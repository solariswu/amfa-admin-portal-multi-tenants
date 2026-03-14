import * as crypto from "crypto";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { PutObjectCommand } from "@aws-sdk/client-s3";

const headers = {
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With",
  "Access-Control-Allow-Credentials": true,
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST",
};

const lambda = new LambdaClient({ region: process.env.AWS_REGION });

const genImportUsersJob = async (
  userPoolId,
  admin,
  notify,
  totalusernumber,
  dynamodb,
  importJobTable,
) => {
  console.log("generating user import job id for userpool id:", userPoolId);

  const jobid = crypto.randomUUID();
  const timestamp = Date.now();

  const params = {
    Item: {
      jobid: {
        S: jobid,
      },
      notify: {
        BOOL: notify,
      },
      jobstatus: {
        S: "PENDING",
      },
      totalusers: {
        N: `${totalusernumber}`,
      },
      userpoolid: {
        S: userPoolId,
      },
      createdby: {
        S: admin ? admin : '',
      },
      timestamp: {
        N: `${timestamp}`,
      },
      ttl: {
        N: `${parseInt(timestamp / 1000 + 3600 * 24 * 7)}`, //7 days
      },
    },
    ReturnConsumedCapacity: "TOTAL",
    TableName: importJobTable,
  };

  console.log ("params:", params)
  const putItemCommand = new PutItemCommand(params);
  const results = await dynamodb.send(putItemCommand);
  console.log("user import job id creation result:", results);

  return jobid;
};

export const postResData = async (data, userpoolId, tenantId, dynamodbISP, s3, importJobTable) => {
  try {
    const jobid = await genImportUsersJob(
      userpoolId,
      data.admin,
      data.notify,
      data.totalusers,
      dynamodbISP,
      importJobTable,
    );

    // start worker lambda with event type
    console.log("start worker lambda with event type");

    const params = {
      Bucket: process.env.IMPORTUSERS_BUCKET,
      Key: `jobs/${jobid}`,
      Body: JSON.stringify(data.userData),
    }

    console.log("jobdata s3 params:", params)
    const res = await s3.send(new PutObjectCommand(params))
    console.log("upload jobdata to s3:", res)

    const command = new InvokeCommand({
      FunctionName: process.env.IMPORTUSERS_WORKER_LAMBDA,
      InvocationType: "Event",
      Payload: JSON.stringify({
        jobid,
        notify: data.notify,
        userpoolId,
        tenantId,
        admin: data.admin,
        tableName: importJobTable,
      }),
    });

    const response = await lambda.send(command);
    console.log("start worker lambda response:", response);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: "Import job started.", JobId: jobid }),
    };
  } catch (e) {
    console.log("Catch an error: ", e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: "Failed to start import job." }),
    };
  }
};

export default postResData;
