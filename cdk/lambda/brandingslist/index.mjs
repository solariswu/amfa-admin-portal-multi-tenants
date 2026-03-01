import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { createResponse } from 'admin-auth';

const s3ISP = new S3Client({ region: process.env.AWS_REGION });
const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {

    console.info("EVENT\n" + JSON.stringify(event, null, 2))

    // Extract user role from JWT
    const groups = event.requestContext?.authorizer?.jwt?.claims?.['cognito:groups'];
    const role = groups ? (Array.isArray(groups) ? groups[0] : groups) : null;
    
    if (!role) {
        return createResponse(403, { error: 'User role not found in JWT' });
    }

    console.log('User role:', role);

    // Helper function to get branding from S3
    const getResData = async (bucketName, s3) => {
        try {
            const params = {
                Bucket: bucketName,
                Key: 'branding.json',
            };
            const data = await s3.send(new GetObjectCommand(params));
            const body = await data.Body.transformToString();
            
            console.log('Got branding from bucket:', bucketName);
            return JSON.parse(body);
        } catch (error) {
            console.error(`Error getting branding from ${bucketName}:`, error.message);
            return null;
        }
    }

    // Get accessible tenants based on role
    const getAccessibleTenants = async () => {
        if (role === 'SA') {
            // Super Admin: Get all tenants (filter by type)
            const scanResult = await dynamodb.send(new ScanCommand({
                TableName: process.env.AMFATENANT_TABLE,
                FilterExpression: '#type = :type AND #status = :status',
                ProjectionExpression: 'id, #n, org_id',
                ExpressionAttributeNames: {
                    '#n': 'name',
                    '#type': 'type',
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':type': { S: 'tenant' },
                    ':status': { S: 'active' }
                }
            }));
            return scanResult.Items?.map(item => ({
                id: item.id.S.replace('TENANT#', ''), // Strip prefix
                name: item.name?.S,
                org_id: item.org_id?.S
            })) || [];
        } else if (role.startsWith('SPA_')) {
            // Service Provider Admin: Get tenants in their org
            const orgId = role.substring(4);
            const queryResult = await dynamodb.send(new QueryCommand({
                TableName: process.env.AMFATENANT_TABLE,
                IndexName: 'org-id-index',
                KeyConditionExpression: 'org_id = :orgId',
                FilterExpression: '#type = :type AND #status = :status',
                ExpressionAttributeValues: {
                    ':orgId': { S: orgId },
                    ':type': { S: 'tenant' },
                    ':status': { S: 'active' }
                },
                ProjectionExpression: 'id, #n, org_id',
                ExpressionAttributeNames: {
                    '#n': 'name',
                    '#type': 'type',
                    '#status': 'status'
                }
            }));
            return queryResult.Items?.map(item => ({
                id: item.id.S.replace('TENANT#', ''), // Strip prefix
                name: item.name?.S,
                org_id: item.org_id?.S
            })) || [];
        } else if (role.startsWith('TA_')) {
            // Tenant Admin: Only their tenant
            const tenantId = role.substring(3);
            return [{ id: tenantId }];
        } else {
            console.error('Unknown role format:', role);
            return [];
        }
    };

    try {
        const startIdx = 0;
        let resData = [];

        // Always include adminportal branding
        const adminBranding = await getResData(process.env.ADMINPORTAL_BUCKETNAME, s3ISP);
        if (adminBranding) {
            resData.push({ 
                url: process.env.SP_PORTAL_URL, 
                ...adminBranding 
            });
        }

        // Get accessible tenants and their brandings
        const accessibleTenants = await getAccessibleTenants();
        console.log('Accessible tenants:', accessibleTenants.length);

        // Fetch brandings for each accessible tenant
        const promises = accessibleTenants.map(tenant => {
            const bucketName = `${process.env.SPPORTAL_BUCKET_PREFIX}-${tenant.id}-login`;
            return getResData(bucketName, s3ISP).then(branding => ({
                tenant,
                branding
            }));
        });

        const results = await Promise.allSettled(promises);

        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value.branding) {
                resData.push({
                    url: process.env.SP_PORTAL_URL,
                    tenant_id: result.value.tenant.id,
                    tenant_name: result.value.tenant.name,
                    ...result.value.branding
                });
            }
        });

        // Sort by id
        resData.sort((a, b) => {
            if (a.id < b.id) return -1;
            if (a.id > b.id) return 1;
            return 0;
        });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
                'Access-Control-Expose-Headers': 'Content-Range',
                'Content-Range': `brandings ${startIdx + 1}-${startIdx + resData.length}/${resData.length}`,
            },
            body: JSON.stringify({
                data: resData,
                total: resData.length,
            }),
        };
    } catch (error) {
        console.error('Error in brandingslist:', error);
        return createResponse(500, { 
            type: 'exception', 
            message: error.message || 'Service Error' 
        });
    }
};
