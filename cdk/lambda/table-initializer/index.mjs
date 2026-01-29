import { DynamoDBClient, DescribeTableCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient, CreateSecretCommand, GetSecretValueCommand } from '@aws-sdk/client-secretsmanager';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const secretsManager = new SecretsManagerClient({ region: process.env.AWS_REGION });

/**
 * Check if DynamoDB table exists
 */
async function checkTableExists(tableName) {
  try {
    await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`Table ${tableName} exists`);
    return true;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      console.log(`Table ${tableName} does not exist yet`);
      return false;
    }
    throw error;
  }
}

/**
 * Replace environment variable placeholders in config
 */
function replaceEnvVars(config) {
  const configStr = JSON.stringify(config);
  const replaced = configStr.replace(/\$\{(\w+)\}/g, (match, varName) => {
    return process.env[varName] || match;
  });
  return JSON.parse(replaced);
}

/**
 * Register ALL tenants with ASM portal in ONE call
 * This is done once for the entire deployment, not per tenant
 */
async function registerAllTenantsWithASM(config) {
  console.log('Starting ONE-TIME ASM registration for all tenants');
  
  const asmConfig = config.asmRegistration;
  const results = {};
  
  // Process each org and its tenants
  for (const org of config.orgs) {
    for (const tenant of org.tenants) {
      console.log(`Registering tenant ${tenant.tenantId} with ASM portal`);
      
      try {
        // Check if already registered
        let existingRegistration = null;
        try {
          const secretResponse = await secretsManager.send(
            new GetSecretValueCommand({
              SecretId: `apersona/${tenant.tenantId}/install`
            })
          );
          existingRegistration = JSON.parse(secretResponse.SecretString);
          console.log(`Tenant ${tenant.tenantId} already registered, using existing data`);
        } catch (error) {
          if (error.name !== 'ResourceNotFoundException') {
            throw error;
          }
        }
        
        if (existingRegistration) {
          results[tenant.tenantId] = existingRegistration.registRes;
          continue;
        }
        
        // Encode tenant name for URL
        const tenantNameEncoded = encodeURIComponent(tenant.tenantName);
        
        // Call ASM portal API
        const formData = new URLSearchParams({
          newTenantName: tenantNameEncoded,
          awsAccountId: asmConfig.awsAccount,
          newTenantAdminEmail: asmConfig.adminEmail,
          asmSecretKey: asmConfig.asmSecretKey,
          awsUserPoolFqdn: asmConfig.rootDomain,
          awsRegion: asmConfig.awsRegion,
          asmTenantInstallerEmail: asmConfig.installerEmail
        });
        
        console.log(`Calling ASM API: ${asmConfig.asmPortalUrl}/newTenantAssignmentWithDefaults.ap`);
        
        const response = await fetch(
          `${asmConfig.asmPortalUrl}/newTenantAssignmentWithDefaults.ap`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString()
          }
        );
        
        if (!response.ok) {
          throw new Error(`ASM API returned ${response.status}: ${await response.text()}`);
        }
        
        const registrationResult = await response.json();
        console.log(`ASM registration result for ${tenant.tenantId}:`, registrationResult);
        
        // Validate response
        if (!registrationResult.asmClientId || !registrationResult.mobileTokenKey) {
          throw new Error(`Invalid ASM response for ${tenant.tenantId}: missing required fields`);
        }
        
        // Store in Secrets Manager
        const secretString = JSON.stringify({ registRes: registrationResult });
        await secretsManager.send(
          new CreateSecretCommand({
            Name: `apersona/${tenant.tenantId}/install`,
            SecretString: secretString,
            Description: `ASM registration data for tenant ${tenant.tenantId}`
          })
        );
        
        console.log(`Stored ASM registration data for ${tenant.tenantId} in Secrets Manager`);
        
        results[tenant.tenantId] = registrationResult;
        
        // Add small delay between registrations to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`Failed to register tenant ${tenant.tenantId}:`, error);
        throw new Error(`ASM registration failed for ${tenant.tenantId}: ${error.message}`);
      }
    }
  }
  
  console.log('ASM registration completed for all tenants');
  return results;
}

/**
 * Import tenant data to DynamoDB
 */
async function importTenantToDynamoDB(tenant, asmData) {
  console.log(`Importing tenant ${tenant.tenantId} to DynamoDB`);
  
  const item = {
    id: { S: tenant.tenantId },
    name: { S: encodeURIComponent(tenant.tenantName) },
    contact: { S: tenant.contactEmail },
    org_id: { S: tenant.orgId },
    url: { S: `https://${tenant.tenantId}.${process.env.ROOT_DOMAIN_NAME}` },
    endUserSpUrl: { S: `https://${tenant.tenantId}.${process.env.ROOT_DOMAIN_NAME}` },
    samlproxy: { BOOL: tenant.samlproxy !== false },
    userpool: { S: '' }, // Will be populated during provisioning
    // Store ASM data for reference
    asmClientId: { S: asmData.asmClientId },
    mobileTokenKey: { S: asmData.mobileTokenKey },
    // Timestamps
    createdAt: { N: Date.now().toString() },
    updatedAt: { N: Date.now().toString() }
  };
  
  // Add optional description if present
  if (tenant.description) {
    item.description = { S: tenant.description };
  }
  
  await dynamodb.send(
    new PutItemCommand({
      TableName: process.env.AMFATENANT_TABLE,
      Item: item
    })
  );
  
  console.log(`Successfully imported tenant ${tenant.tenantId}`);
}

/**
 * Main handler for table initialization custom resource
 */
export const handler = async (event) => {
  console.log('Table Initializer Lambda invoked');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const requestType = event.RequestType;
  const physicalResourceId = event.PhysicalResourceId || 'TableInitializer';
  
  // Handle DELETE - just return success
  if (requestType === 'Delete') {
    console.log('Delete request - nothing to do');
    return {
      Status: 'SUCCESS',
      PhysicalResourceId: physicalResourceId,
      Data: {}
    };
  }
  
  try {
    const tableName = process.env.AMFATENANT_TABLE;
    
    // Check if table exists
    const tableExists = await checkTableExists(tableName);
    
    if (tableExists) {
      console.log('Table already exists - skipping initialization');
      return {
        Status: 'SUCCESS',
        PhysicalResourceId: physicalResourceId,
        Data: {
          Message: 'Table already exists, skipped initialization',
          TableName: tableName
        }
      };
    }
    
    console.log('Table does not exist yet - will initialize after table creation');
    console.log('Note: This Lambda will be invoked again after table is created');
    
    // Wait a bit for table to be created
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check again
    const tableExistsNow = await checkTableExists(tableName);
    if (!tableExistsNow) {
      console.log('Table still not ready, will retry on next invocation');
      return {
        Status: 'SUCCESS',
        PhysicalResourceId: physicalResourceId,
        Data: {
          Message: 'Waiting for table creation',
          TableName: tableName
        }
      };
    }
    
    console.log('Table is ready, starting initialization...');
    
    // Load and parse config file
    const configPath = resolve(__dirname, '../../../../amfa-service-multi-tenants/tenants-config.json');
    console.log(`Loading config from: ${configPath}`);
    
    const configContent = readFileSync(configPath, 'utf-8');
    const rawConfig = JSON.parse(configContent);
    
    // Replace environment variables
    const config = replaceEnvVars(rawConfig);
    console.log('Configuration loaded and env vars replaced');
    
    // Perform ONE-TIME ASM registration for all tenants
    const asmResults = await registerAllTenantsWithASM(config);
    
    // Import all tenants to DynamoDB
    let importedCount = 0;
    for (const org of config.orgs) {
      for (const tenant of org.tenants) {
        await importTenantToDynamoDB(
          { ...tenant, orgId: org.orgId },
          asmResults[tenant.tenantId]
        );
        importedCount++;
      }
    }
    
    console.log(`Successfully initialized table with ${importedCount} tenants`);
    
    return {
      Status: 'SUCCESS',
      PhysicalResourceId: physicalResourceId,
      Data: {
        Message: 'Table initialized successfully',
        TableName: tableName,
        TenantsImported: importedCount,
        Organizations: config.orgs.length
      }
    };
    
  } catch (error) {
    console.error('Initialization failed:', error);
    return {
      Status: 'FAILED',
      PhysicalResourceId: physicalResourceId,
      Reason: error.message,
      Data: {}
    };
  }
};
