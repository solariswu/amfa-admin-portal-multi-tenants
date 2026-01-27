import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { validateTenantAccess, getTenantIdFromRequest, createResponse } from 'admin-auth';

const s3ISP = new S3Client({ region: process.env.AWS_REGION });
const cloudFront = new CloudFrontClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {

    console.info("EVENT\n" + JSON.stringify(event, null, 2))
    console.log('event.requestContext.http.method: ', event.requestContext.http.method);

    // 1. Extract tenant_id from request (for spportal only)
    const portalType = event.pathParameters?.id; // "spportal" or "adminportal"
    
    let tenantId = null;
    let authResult = null;
    
    // Only validate tenant access for spportal (tenant-specific)
    // adminportal uses shared branding
    if (portalType === 'spportal') {
        tenantId = getTenantIdFromRequest(event);
        
        if (!tenantId) {
            return createResponse(400, { error: 'tenant_id required for spportal branding' });
        }

        // 2. Validate authorization
        authResult = await validateTenantAccess(event, tenantId);
        
        if (!authResult.authorized) {
            return createResponse(authResult.statusCode, { error: authResult.error });
        }
        
        console.log(`Authorized access for tenant ${tenantId}, portal: ${portalType}`);
    }

    const getBucketName = (portalType, tenantId) => {
        if (portalType === 'spportal') {
            // Tenant-specific bucket for service provider portal
            return `${process.env.SPPORTAL_BUCKET_PREFIX}-${tenantId}-login`;
        } else if (portalType === 'adminportal') {
            // Shared bucket for admin portal
            return process.env.ADMINPORTAL_BUCKETNAME;
        }
        throw new Error(`Unknown portal type: ${portalType}`);
    };

    const getDistributionId = (portalType) => {
        if (portalType === 'spportal') {
            return process.env.SPPORTAL_DISTRIBUTION_ID;
        } else if (portalType === 'adminportal') {
            return process.env.ADMINPORTAL_DISTRIBUTION_ID;
        }
        throw new Error(`Unknown portal type: ${portalType}`);
    };

    const getResData = async (portalType, tenantId, s3) => {
        const bucketName = getBucketName(portalType, tenantId);
        const params = {
            Bucket: bucketName,
            Key: 'branding.json',
        };
        console.log('Getting branding from bucket:', bucketName);
        const data = await s3.send(new GetObjectCommand(params));
        const body = await data.Body.transformToString();

        return JSON.parse(body);
    }

    const putResData = async (data, portalType, tenantId, s3, cloudFront) => {
        const bucketName = getBucketName(portalType, tenantId);
        const distributionId = getDistributionId(portalType);
        
        const params = {
            Bucket: bucketName,
            Key: 'branding.json',
            Body: JSON.stringify(data),
        };
        console.log('Putting branding to bucket:', bucketName);
        await s3.send(new PutObjectCommand(params));

        if (distributionId) {
            console.log('Creating CloudFront invalidation for distribution:', distributionId);
            await cloudFront.send(new CreateInvalidationCommand({
                DistributionId: distributionId,
                InvalidationBatch: {
                    CallerReference: Date.now().toString(),
                    Paths: {
                        Quantity: 1,
                        Items: [
                            '/branding.json'
                        ]
                    }
                }
            }));
        }

        return data;
    }

    try {
        switch (event.requestContext.http.method) {
            case 'GET':
                const getResult = await getResData(portalType, tenantId, s3ISP);
                return createResponse(200, { data: { url: process.env.SP_PORTAL_URL, ...getResult } });
            case 'PUT':
                const payload = JSON.parse(event.body);
                const putResult = await putResData(payload.data, portalType, tenantId, s3ISP, cloudFront);
                return createResponse(200, { data: putResult });
            case 'OPTIONS':
                return createResponse(200, { data: 'ok' });
            default:
                return createResponse(404, { data: 'Not Found' });
        }
    }
    catch (e) {
        console.log('Catch an error: ', e);
        return createResponse(500, { type: 'exception', message: e.message || 'Service Error' });
    }
}
