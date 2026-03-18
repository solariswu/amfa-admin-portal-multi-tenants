import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import {
  validateTenantAccess,
  getTenantIdFromRequest,
  createResponse,
} from "admin-auth";

const s3ISP = new S3Client({ region: process.env.AWS_REGION });
const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const cloudFront = new CloudFrontClient({ region: process.env.AWS_REGION });

/**
 * Construct the shared SP Portal bucket name from environment variables.
 */
function getSharedSpPortalBucket() {
  const prefix = process.env.SPPORTAL_BUCKET_PREFIX || "";
  const accountId = prefix.split("-")[0] || "";
  const region = process.env.AWS_REGION || "us-east-1";
  return `sp-portal-shared-${accountId}-${region}`;
}

/**
 * Get AMFA branding from DynamoDB
 */
async function getAmfaBranding(tenantId) {
  const configTable = process.env.AMFACONFIG_TABLE;
  if (!configTable) throw new Error("AMFACONFIG_TABLE not set");

  const result = await dynamodb.send(new GetItemCommand({
    TableName: configTable,
    Key: {
      id: { S: tenantId },
      configtype: { S: 'amfaBrandings' },
    },
  }));

  if (result.Item?.value?.S) {
    return JSON.parse(result.Item.value.S);
  }
  return null;
}

/**
 * Put AMFA branding to DynamoDB
 */
async function putAmfaBranding(tenantId, data) {
  const configTable = process.env.AMFACONFIG_TABLE;
  if (!configTable) throw new Error("AMFACONFIG_TABLE not set");

  await dynamodb.send(new PutItemCommand({
    TableName: configTable,
    Item: {
      id: { S: tenantId },
      configtype: { S: 'amfaBrandings' },
      value: { S: JSON.stringify(data) },
    },
  }));

  return data;
}

export const handler = async (event) => {
  console.info("EVENT\n" + JSON.stringify(event, null, 2));
  console.log("event.requestContext.http.method:", event.requestContext.http.method);

  const portalType = event.pathParameters?.id;

  // Check if this is an AMFA Service branding request (id ends with _amfa)
  const isAmfaBranding = portalType?.endsWith('_amfa');
  const isSpPortalBranding = portalType?.endsWith('_spportal');

  if (isAmfaBranding) {
    // ===== AMFA Service branding (DynamoDB) =====
    const tenantId = portalType.replace(/_amfa$/, '');

    // Validate tenant access
    const authResult = await validateTenantAccess(event, tenantId);
    if (!authResult.authorized) {
      return createResponse(authResult.statusCode, { error: authResult.error });
    }

    console.log(`AMFA branding request for tenant: ${tenantId}`);

    try {
      switch (event.requestContext.http.method) {
        case "GET":
          const amfaData = await getAmfaBranding(tenantId);
          return createResponse(200, {
            data: {
              id: portalType,
              portal_type: 'Login Service Portal',
              tenant_id: tenantId,
              tenant_name: amfaData?.service_name || tenantId,
              name: amfaData?.service_name || tenantId,
              ...(amfaData || {}),
            },
          });
        case "PUT":
          const payload = JSON.parse(event.body);
          const putData = payload.data;
          // Remove non-branding fields before saving
          const { id, portal_type, tenant_id, tenant_name, name, ...brandingData } = putData;
          const savedData = await putAmfaBranding(tenantId, brandingData);
          return createResponse(200, { data: { id: portalType, ...savedData } });
        case "OPTIONS":
          return createResponse(200, { data: "ok" });
        default:
          return createResponse(404, { data: "Not Found" });
      }
    } catch (e) {
      console.log("AMFA branding error:", e);
      return createResponse(500, { type: "exception", message: e.message || "Service Error" });
    }
  }

  // ===== SP Portal / Admin Portal branding (S3) =====
  const spPortalBucket = getSharedSpPortalBucket();
  let s3Key;
  let tenantId = null;

  if (isSpPortalBranding) {
    // Tenant SP Portal branding: /brandings/{tenantId}_spportal
    tenantId = portalType.replace(/_spportal$/, '');
    s3Key = `branding_${tenantId}.json`;

    const authResult = await validateTenantAccess(event, tenantId);
    if (!authResult.authorized) {
      return createResponse(authResult.statusCode, { error: authResult.error });
    }
  } else if (portalType === "adminportal") {
    // Admin portal branding: branding.json
    s3Key = "branding.json";
  } else {
    // Legacy: portalType is a tenantId directly (e.g., /brandings/testtenantb)
    tenantId = portalType;
    s3Key = `branding_${tenantId}.json`;

    // If a tenant_id header is provided, use that instead
    const headerTenantId = getTenantIdFromRequest(event);
    if (headerTenantId) {
      tenantId = headerTenantId;
      s3Key = `branding_${tenantId}.json`;
    }

    if (tenantId && tenantId !== 'adminportal') {
      const authResult = await validateTenantAccess(event, tenantId);
      if (!authResult.authorized) {
        return createResponse(authResult.statusCode, { error: authResult.error });
      }
    }
  }

  console.log(`SP Portal branding request: bucket=${spPortalBucket}, key=${s3Key}, tenantId=${tenantId}`);

  const getResData = async () => {
    const params = { Bucket: spPortalBucket, Key: s3Key };
    console.log(`Getting branding from s3://${spPortalBucket}/${s3Key}`);
    const data = await s3ISP.send(new GetObjectCommand(params));
    const body = await data.Body.transformToString();
    return JSON.parse(body);
  };

  const putResData = async (data) => {
    const params = {
      Bucket: spPortalBucket,
      Key: s3Key,
      Body: JSON.stringify(data, null, 2),
      ContentType: "application/json",
    };
    console.log(`Putting branding to s3://${spPortalBucket}/${s3Key}`);
    await s3ISP.send(new PutObjectCommand(params));

    const distributionId =
      process.env.SPPORTAL_DISTRIBUTION_ID ||
      process.env.ADMINPORTAL_DISTRIBUTION_ID;
    if (distributionId) {
      try {
        await cloudFront.send(
          new CreateInvalidationCommand({
            DistributionId: distributionId,
            InvalidationBatch: {
              CallerReference: Date.now().toString(),
              Paths: { Quantity: 1, Items: [`/${s3Key}`] },
            },
          }),
        );
      } catch (cfError) {
        console.warn("CloudFront invalidation failed (non-fatal):", cfError.message);
      }
    }

    return data;
  };

  try {
    switch (event.requestContext.http.method) {
      case "GET":
        const getResult = await getResData();
        return createResponse(200, {
          data: {
            ...getResult,
            id: portalType, // must be AFTER spread to prevent overwrite by S3 data
            url: process.env.SP_PORTAL_URL,
            tenant_id: tenantId,
          },
        });
      case "PUT":
        const payload = JSON.parse(event.body);
        const putResult = await putResData(payload.data);
        return createResponse(200, { data: putResult });
      case "OPTIONS":
        return createResponse(200, { data: "ok" });
      default:
        return createResponse(404, { data: "Not Found" });
    }
  } catch (e) {
    console.log("Catch an error:", e);
    return createResponse(500, { type: "exception", message: e.message || "Service Error" });
  }
};
