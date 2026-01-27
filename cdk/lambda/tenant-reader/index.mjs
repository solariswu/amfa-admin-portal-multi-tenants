import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

export const handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const { RequestType, ResourceProperties } = event;
  const { TableName } = ResourceProperties;
  
  if (RequestType === 'Delete') {
    return {
      Status: 'SUCCESS',
      PhysicalResourceId: 'tenant-reader',
      Data: {}
    };
  }
  
  try {
    // Scan the tenant table to get all tenants
    const params = {
      TableName: TableName
    };
    
    const result = await dynamodb.send(new ScanCommand(params));
    const tenants = result.Items || [];
    
    console.log('Found tenants:', JSON.stringify(tenants, null, 2));
    
    // Transform tenant data to the format needed
    const tenantData = tenants.map(tenant => ({
      tenantId: tenant.id,
      tenantName: tenant.name,
      userPoolId: tenant.userpool,
      endUserSpUrl: tenant.endUserSpUrl,
      extraAppUrl: tenant.extraappurl || '',
      samlProxy: tenant.samlproxy || true,
      samlIdPMetadataUrl: tenant.samlIdPMetadataUrl,
      endUserClientId: tenant.enduserclientid,
      region: tenant.region || process.env.AWS_REGION,
      spPortalDomain: `login.${tenant.tenantId}.${process.env.ROOT_DOMAIN_NAME}`
    }));
    
    return {
      Status: 'SUCCESS',
      PhysicalResourceId: 'tenant-reader',
      Data: {
        Tenants: JSON.stringify(tenantData),
        TenantCount: tenantData.length.toString()
      }
    };
  } catch (error) {
    console.error('Error reading tenants:', error);
    return {
      Status: 'FAILED',
      PhysicalResourceId: 'tenant-reader',
      Reason: error.message
    };
  }
};
