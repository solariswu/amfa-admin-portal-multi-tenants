import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
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
const cloudFront = new CloudFrontClient({ region: process.env.AWS_REGION });

/**
 * Construct the shared SP Portal bucket name from environment variables.
 * In the new shared architecture, all branding files are in one bucket.
 */
function getSharedSpPortalBucket() {
  const prefix = process.env.SPPORTAL_BUCKET_PREFIX || "";
  const accountId = prefix.split("-")[0] || "";
  const region = process.env.AWS_REGION || "us-east-1";
  return `sp-portal-shared-${accountId}-${region}`;
}

export const handler = async (event) => {
  console.info("EVENT\n" + JSON.stringify(event, null, 2));
  console.log(
    "event.requestContext.http.method: ",
    event.requestContext.http.method,
  );

  // portalType is the path parameter: "spportal", "adminportal", or a tenantId
  const portalType = event.pathParameters?.id;

  // Determine the S3 bucket and key for branding
  const spPortalBucket = getSharedSpPortalBucket();
  let s3Key;
  let tenantId = null;

  if (portalType === "spportal" || portalType === "adminportal") {
    // Default/admin branding: branding.json in shared SP Portal bucket
    s3Key = "branding.json";

    // If a tenant_id is provided in query/body, use tenant-specific branding
    tenantId = getTenantIdFromRequest(event);
    if (tenantId) {
      s3Key = `branding_${tenantId}.json`;

      // Validate tenant access
      const authResult = await validateTenantAccess(event, tenantId);
      if (!authResult.authorized) {
        return createResponse(authResult.statusCode, {
          error: authResult.error,
        });
      }
    }
  } else {
    // portalType is a tenantId directly (e.g., /brandings/testtenantb)
    tenantId = portalType;
    s3Key = `branding_${tenantId}.json`;

    // Validate tenant access
    const authResult = await validateTenantAccess(event, tenantId);
    if (!authResult.authorized) {
      return createResponse(authResult.statusCode, { error: authResult.error });
    }
  }

  console.log(
    `Branding request: bucket=${spPortalBucket}, key=${s3Key}, tenantId=${tenantId}`,
  );

  const getResData = async () => {
    const params = {
      Bucket: spPortalBucket,
      Key: s3Key,
    };
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

    // Invalidate CloudFront cache for the branding file
    const distributionId =
      process.env.SPPORTAL_DISTRIBUTION_ID ||
      process.env.ADMINPORTAL_DISTRIBUTION_ID;
    if (distributionId) {
      console.log(
        "Creating CloudFront invalidation for distribution:",
        distributionId,
      );
      try {
        await cloudFront.send(
          new CreateInvalidationCommand({
            DistributionId: distributionId,
            InvalidationBatch: {
              CallerReference: Date.now().toString(),
              Paths: {
                Quantity: 1,
                Items: [`/${s3Key}`],
              },
            },
          }),
        );
      } catch (cfError) {
        console.warn(
          "CloudFront invalidation failed (non-fatal):",
          cfError.message,
        );
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
            id: portalType,
            url: process.env.SP_PORTAL_URL,
            tenant_id: tenantId,
            ...getResult,
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
    console.log("Catch an error: ", e);
    return createResponse(500, {
      type: "exception",
      message: e.message || "Service Error",
    });
  }
};
