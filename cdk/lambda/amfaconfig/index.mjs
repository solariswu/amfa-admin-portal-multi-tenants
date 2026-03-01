import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, DescribeUserPoolCommand } from "@aws-sdk/client-cognito-identity-provider";
import { validateTenantAccess, getTenantIdFromRequest, createResponse } from 'admin-auth';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

const configs = ['amfaConfigs', 'amfaPolicies'];

export const handler = async (event) => {
    console.info("EVENT\n" + JSON.stringify(event, null, 2));

    // 1. Extract tenant_id from request
    const tenantId = getTenantIdFromRequest(event);
    
    if (!tenantId) {
        return createResponse(400, { error: 'tenant_id required in request' });
    }

    // 2. Validate authorization and get tenant info
    const authResult = await validateTenantAccess(event, tenantId);
    
    if (!authResult.authorized) {
        return createResponse(authResult.statusCode, { error: authResult.error });
    }

    const { userPoolId } = authResult;
    
    console.log(`Authorized access for tenant ${tenantId}, userPoolId: ${userPoolId}`);

    // 3. Fetch configs, tenant SAML info, and user pool details
    let promises = [];

    // Fetch amfaConfigs and amfaPolicies
    configs.forEach(configType => {
        const params = {
            TableName: process.env.AMFACONFIG_TABLE,
            Key: {
                id: { S: tenantId },
                configtype: { S: configType },
            },
        };
        promises.push(dynamodb.send(new GetItemCommand(params)));
    });

    // Fetch tenant SAML info using composite key
    const tenantParams = {
        TableName: process.env.AMFATENANT_TABLE,
        KeyConditionExpression: 'id = :id AND begins_with(sk, :sk_prefix)',
        ExpressionAttributeValues: {
            ':id': { S: `TENANT#${tenantId}` },
            ':sk_prefix': { S: 'TENANT#' }
        }
    };
    promises.push(dynamodb.send(new QueryCommand(tenantParams)));

    // Describe user pool to get total user count
    promises.push(cognito.send(new DescribeUserPoolCommand({
        UserPoolId: userPoolId,
    })));

    const [configRes, policyRes, tenantRes, cognitoRes] = await Promise.allSettled(promises);

    console.log('configRes', configRes);
    console.log('policyRes', policyRes);
    console.log('tenantRes', tenantRes);
    console.log('cognitoRes', cognitoRes);

    // Check if any critical queries failed
    if (configRes.status === 'rejected' || policyRes.status === 'rejected' || 
        tenantRes.status === 'rejected' || cognitoRes.status === 'rejected') {
        console.error('One or more queries failed:', {
            config: configRes.status === 'rejected' ? configRes.reason : 'ok',
            policy: policyRes.status === 'rejected' ? policyRes.reason : 'ok',
            tenant: tenantRes.status === 'rejected' ? tenantRes.reason : 'ok',
            cognito: cognitoRes.status === 'rejected' ? cognitoRes.reason : 'ok',
        });
        return createResponse(500, { error: 'Internal server error fetching configurations' });
    }

    // Parse and return results
    // Note: tenantRes is now a Query result (Items array) not GetItem (Item)
    const tenantItem = tenantRes.value.Items?.[0];
    
    return createResponse(200, {
        amfaConfigs: configRes.value.Item?.value?.S ? JSON.parse(configRes.value.Item.value.S) : {},
        amfaPolicies: policyRes.value.Item?.value?.S ? JSON.parse(policyRes.value.Item.value.S) : {},
        samlProxyEnabled: tenantItem?.samlproxy?.BOOL ?? false,
        totalUserNumber: cognitoRes.value.UserPool?.EstimatedNumberOfUsers ?? 0,
    });
};
