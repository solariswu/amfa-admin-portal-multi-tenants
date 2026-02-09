import { GetItemCommand } from '@aws-sdk/client-dynamodb';

/**
 * Get a single organization by ID
 * This is a local copy to avoid cross-directory imports that break Lambda deployments
 */
export async function getOrganization(orgId, dynamodb, tableName) {
  console.log('Getting organization:', orgId);
  
  const params = {
    TableName: tableName,
    Key: {
      id: { S: `ORG#${orgId}` }
    }
  };
  
  const result = await dynamodb.send(new GetItemCommand(params));
  
  if (!result.Item) {
    console.log('Organization not found:', orgId);
    return null;
  }
  
  return {
    id: orgId,
    name: result.Item.name?.S || '',
    description: result.Item.description?.S || '',
    created_at: result.Item.created_at?.S || '',
    created_by: result.Item.created_by?.S || '',
    created_by_name: result.Item.created_by_name?.S || ''
  };
}
