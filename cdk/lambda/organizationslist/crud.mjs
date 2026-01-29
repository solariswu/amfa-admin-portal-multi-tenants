import { 
  PutItemCommand, 
  GetItemCommand, 
  ScanCommand,
  DeleteItemCommand 
} from '@aws-sdk/client-dynamodb';

/**
 * List all organizations from DynamoDB
 * Organizations are stored with id prefix "ORG#" and type="organization"
 */
export async function listOrganizations(dynamodb, tableName) {
  console.log('Listing organizations from table:', tableName);
  
  const params = {
    TableName: tableName,
    FilterExpression: '#type = :type',
    ExpressionAttributeNames: {
      '#type': 'type'
    },
    ExpressionAttributeValues: {
      ':type': { S: 'organization' }
    }
  };
  
  const result = await dynamodb.send(new ScanCommand(params));
  console.log(`Found ${result.Items?.length || 0} organizations`);
  
  return (result.Items || []).map(item => ({
    id: item.id.S.replace('ORG#', ''),  // Remove prefix for display
    name: item.name?.S || '',
    description: item.description?.S || '',
    created_at: item.created_at?.S || '',
    created_by: item.created_by?.S || '',
    created_by_name: item.created_by_name?.S || ''
  }));
}

/**
 * Create a new organization
 */
export async function createOrganization(data, creatorEmail, creatorName, dynamodb, tableName) {
  console.log('Creating organization:', data);
  
  // Check if org already exists
  const existing = await getOrganization(data.id, dynamodb, tableName);
  if (existing) {
    throw new Error(`Organization '${data.id}' already exists`);
  }
  
  const now = new Date().toISOString();
  
  const params = {
    TableName: tableName,
    Item: {
      id: { S: `ORG#${data.id}` },  // Prefix for identification
      type: { S: 'organization' },
      name: { S: data.name },
      description: { S: data.description || '' },
      created_at: { S: now },
      created_by: { S: creatorEmail },
      created_by_name: { S: creatorName }
    }
  };
  
  await dynamodb.send(new PutItemCommand(params));
  console.log('Organization created successfully:', data.id);
  
  return {
    id: data.id,
    name: data.name,
    description: data.description || '',
    created_at: now,
    created_by: creatorEmail,
    created_by_name: creatorName
  };
}

/**
 * Get a single organization by ID
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

/**
 * Check if an organization has any tenants
 */
export async function orgHasTenants(orgId, dynamodb, tableName) {
  console.log('Checking if org has tenants:', orgId);
  
  const params = {
    TableName: tableName,
    FilterExpression: 'org_id = :orgId AND attribute_not_exists(#type)',
    ExpressionAttributeNames: {
      '#type': 'type'
    },
    ExpressionAttributeValues: {
      ':orgId': { S: orgId }
    },
    Limit: 1
  };
  
  const result = await dynamodb.send(new ScanCommand(params));
  const hasTenants = result.Items && result.Items.length > 0;
  
  console.log(`Org ${orgId} has tenants:`, hasTenants);
  return hasTenants;
}

/**
 * Update an organization
 */
export async function updateOrganization(orgId, data, dynamodb, tableName) {
  console.log('Updating organization:', orgId, data);
  
  // Verify organization exists
  const existing = await getOrganization(orgId, dynamodb, tableName);
  if (!existing) {
    throw new Error(`Organization '${orgId}' not found`);
  }
  
  const now = new Date().toISOString();
  
  const params = {
    TableName: tableName,
    Key: {
      id: { S: `ORG#${orgId}` }
    },
    UpdateExpression: 'SET #name = :name, description = :description, updated_at = :updated_at',
    ExpressionAttributeNames: {
      '#name': 'name'
    },
    ExpressionAttributeValues: {
      ':name': { S: data.name },
      ':description': { S: data.description || '' },
      ':updated_at': { S: now }
    },
    ReturnValues: 'ALL_NEW'
  };
  
  const result = await dynamodb.send(new PutItemCommand(params));
  console.log('Organization updated successfully:', orgId);
  
  return {
    id: orgId,
    name: result.Attributes.name.S,
    description: result.Attributes.description?.S || '',
    created_at: result.Attributes.created_at?.S || '',
    created_by: result.Attributes.created_by?.S || '',
    created_by_name: result.Attributes.created_by_name?.S || '',
    updated_at: now
  };
}

/**
 * Delete an organization (only if it has no tenants)
 */
export async function deleteOrganization(orgId, dynamodb, tableName) {
  console.log('Deleting organization:', orgId);
  
  // Check if org has tenants
  const hasTenants = await orgHasTenants(orgId, dynamodb, tableName);
  if (hasTenants) {
    throw new Error(`Cannot delete organization '${orgId}' because it has tenants`);
  }
  
  const params = {
    TableName: tableName,
    Key: {
      id: { S: `ORG#${orgId}` }
    }
  };
  
  await dynamodb.send(new DeleteItemCommand(params));
  console.log('Organization deleted successfully:', orgId);
  
  return true;
}
