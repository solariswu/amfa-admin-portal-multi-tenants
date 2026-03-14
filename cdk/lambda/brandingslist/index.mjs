import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient, ScanCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { createResponse } from 'admin-auth';

const s3ISP = new S3Client({ region: process.env.AWS_REGION });
const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {

    console.info("EVENT\n" + JSON.stringify(event, null, 2))

    // Extract user role from JWT
    // Cognito may return groups as an array, a string "[SA]", or a plain string "SA"
    const rawGroups = event.requestContext?.authorizer?.jwt?.claims?.['cognito:groups'];
    let role = null;
    if (rawGroups) {
        if (Array.isArray(rawGroups)) {
            role = rawGroups[0];
        } else if (typeof rawGroups === 'string') {
            // Handle "[SA]" or "[SA, SPA_org1]" string format from Cognito
            const cleaned = rawGroups.replace(/[\[\]]/g, '').trim();
            role = cleaned.split(/\s*,\s*/)[0] || null;
        } else {
            role = rawGroups;
        }
    }

    if (!role) {
        return createResponse(403, { error: 'User role not found in JWT' });
    }

    console.log('User role:', role);

    // Helper function to get branding from S3
    const getResData = async (bucketName, key, s3) => {
        try {
            const params = {
                Bucket: bucketName,
                Key: key,
            };
            const data = await s3.send(new GetObjectCommand(params));
            const body = await data.Body.transformToString();

            console.log(`Got branding from s3://${bucketName}/${key}`);
            return JSON.parse(body);
        } catch (error) {
            console.error(`Error getting branding from s3://${bucketName}/${key}:`, error.message);
            return null;
        }
    }

    // Helper function to get AMFA service branding from DynamoDB
    const getAmfaBranding = async (tenantId) => {
        try {
            const configTable = process.env.AMFACONFIG_TABLE;
            if (!configTable) {
                console.warn('AMFACONFIG_TABLE not set, skipping AMFA service branding');
                return null;
            }
            const result = await dynamodb.send(new GetItemCommand({
                TableName: configTable,
                Key: {
                    id: { S: tenantId },
                    configtype: { S: 'amfaBrandings' },
                },
            }));
            if (result.Item?.value?.S) {
                console.log(`Got AMFA branding from DynamoDB for tenant ${tenantId}`);
                return JSON.parse(result.Item.value.S);
            }
            return null;
        } catch (error) {
            console.error(`Error getting AMFA branding for tenant ${tenantId}:`, error.message);
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

        const spPortalBucket = `sp-portal-shared-${process.env.SPPORTAL_BUCKET_PREFIX?.split('-')[0] || ''}-${process.env.AWS_REGION || 'us-east-1'}`;

        // SA only: include admin portal branding from shared SP Portal bucket
        if (role === 'SA') {
            const adminBranding = await getResData(spPortalBucket, 'branding.json', s3ISP);
            if (adminBranding) {
                resData.push({ 
                    id: 'adminportal',
                    portal_type: 'Admin Portal',
                    url: process.env.SP_PORTAL_URL, 
                    ...adminBranding 
                });
            }
        }

        // Get accessible tenants and their brandings
        const accessibleTenants = await getAccessibleTenants();
        console.log('Accessible tenants:', accessibleTenants.length);

        // Fetch tenant brandings from both SP Portal (S3) and AMFA Service (DynamoDB)
        const promises = accessibleTenants.map(tenant => {
            return Promise.all([
                // SP Portal branding (from S3)
                getResData(spPortalBucket, `branding_${tenant.id}.json`, s3ISP),
                // AMFA Service branding (from DynamoDB)
                getAmfaBranding(tenant.id),
            ]).then(([spBranding, amfaBranding]) => ({
                tenant,
                spBranding,
                amfaBranding,
            }));
        });

        const results = await Promise.allSettled(promises);

        results.forEach(result => {
            if (result.status === 'fulfilled') {
                const { tenant, spBranding, amfaBranding } = result.value;

                // Add SP Portal branding entry (End User Portal)
                if (spBranding) {
                    resData.push({
                        id: `${tenant.id}_spportal`,
                        portal_type: 'End User Portal',
                        url: process.env.SP_PORTAL_URL,
                        tenant_id: tenant.id,
                        tenant_name: tenant.name,
                        ...spBranding,
                        name: tenant.name, // ensure name is always tenant name
                    });
                }

                // Add AMFA Service branding entry (Login Service Portal)
                if (amfaBranding) {
                    resData.push({
                        id: `${tenant.id}_amfa`,
                        portal_type: 'Login Service Portal',
                        url: process.env.SP_PORTAL_URL,
                        tenant_id: tenant.id,
                        tenant_name: tenant.name,
                        // Map AMFA branding fields to the display fields used by BrandingList
                        app_login_logo_url: amfaBranding.logo_url,
                        fav_icon_url: amfaBranding.favicon_url,
                        brand_base_color: amfaBranding.brand_base_color,
                        // Store original AMFA branding data for editing
                        ...amfaBranding,
                       name: amfaBranding.service_name || tenant.name,
                    });
                }
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
