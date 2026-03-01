import { QueryCommand } from "@aws-sdk/client-dynamodb";

/**
 * Get a single organization by ID
 * This is a local copy to avoid cross-directory imports that break Lambda deployments
 */
export async function getOrganization(orgId, dynamodb, tableName) {
  console.log("Getting organization:", orgId);

  // Query with begins_with on sort key to get the organization
  const params = {
    TableName: tableName,
    KeyConditionExpression: "id = :id AND begins_with(sk, :sk_prefix)",
    ExpressionAttributeValues: {
      ":id": { S: `ORG#${orgId}` },
      ":sk_prefix": { S: "ORG#" },
    },
  };

  const result = await dynamodb.send(new QueryCommand(params));

  if (!result.Items || result.Items.length === 0) {
    console.log("Organization not found:", orgId);
    return null;
  }

  const item = result.Items[0];

  return {
    id: orgId,
    sk: item.sk?.S || '',
    name: item.name?.S || '',
    description: item.description?.S || '',
    created_at: item.created_at?.S || '',
    created_by: item.created_by?.S || '',
    created_by_name: item.created_by_name?.S || '',
    updated_at: item.updated_at?.S || '',
    updated_by: item.updated_by?.S || '',
    updated_by_name: item.updated_by_name?.S || '',
    version: parseInt(item.version?.N || '1'),
    status: item.status?.S || 'active'
  };
}
