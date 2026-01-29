/**
 * Tenant Provisioning Lambda - Main Orchestrator
 * 
 * Handles complete tenant provisioning with transaction-like behavior:
 * 1. Validate input data
 * 2. Register with ASM portal (or reuse existing)
 * 3. Provision Cognito resources (UserPool, clients)
 * 3.5. Create per-tenant DynamoDB tables
 * 4. Generate and upload configuration files
 * 5. Save tenant to DynamoDB
 * 6. Return success OR rollback all changes on failure
 * 
 * This Lambda is invoked by the Admin Portal API when creating a new tenant.
 */

import { validateTenantData } from './validation.mjs';
import { getSharedASMCredentials } from './asm-shared.mjs';
import { provisionCognitoResources } from './cognito-provisioning.mjs';
import { createTenantTables } from './table-provisioning.mjs';
import { generateAndUploadConfigs } from './config-generator.mjs';
import { saveTenantToDynamoDB, checkTenantExists } from './dynamodb-operations.mjs';
import { rollbackProvisioning, validateRollback, createRollbackError } from './rollback.mjs';

/**
 * Lambda handler for tenant provisioning
 * 
 * @param {Object} event - Lambda event (API Gateway format)
 * @returns {Object} API Gateway response
 */
export const handler = async (event) => {
  console.log('='.repeat(80));
  console.log('[PROVISION] Tenant Provisioning Lambda started');
  console.log('[PROVISION] Event:', JSON.stringify(event, null, 2));
  console.log('='.repeat(80));
  
  const startTime = Date.now();
  const provisioningLog = [];
  let tenantData;
  
  try {
    // ========================================
    // STEP 1: Validate Input
    // ========================================
    console.log('\n[STEP 1/6] Validating input data...');
    tenantData = validateTenantData(event);
    console.log(`[STEP 1/6] ✓ Validation passed for tenant: ${tenantData.tenantId}`);
    
    // ========================================
    // STEP 1.5: Check tenant doesn't exist
    // ========================================
    console.log('\n[STEP 1.5/6] Checking tenant uniqueness...');
    const exists = await checkTenantExists(tenantData.tenantId);
    if (exists) {
      throw Object.assign(
        new Error(`Tenant with ID '${tenantData.tenantId}' already exists`),
        { statusCode: 409 } // Conflict
      );
    }
    console.log('[STEP 1.5/6] ✓ Tenant ID is unique');
    
    // ========================================
    // STEP 2: Get Shared ASM Credentials
    // ========================================
    console.log('\n[STEP 2/7] Getting shared ASM credentials...');
    const asmData = await getSharedASMCredentials();
    // Note: We don't add ASM to provisioning log since it's shared (not rolled back per tenant)
    console.log('[STEP 2/7] ✓ Using shared ASM credentials');
    console.log(`[STEP 2/7]   ASM Client ID: ${asmData.asmClientId} (shared)`);
    
    // ========================================
    // STEP 3: Cognito Provisioning
    // ========================================
    console.log('\n[STEP 3/7] Provisioning Cognito resources...');
    const cognitoResources = await provisionCognitoResources(tenantData, asmData);
    provisioningLog.push({ 
      step: 'cognito', 
      data: cognitoResources 
    });
    console.log('[STEP 3/7] ✓ Cognito resources created');
    console.log(`[STEP 3/7]   UserPool ID: ${cognitoResources.userPoolId}`);
    console.log(`[STEP 3/7]   SP Portal Client ID: ${cognitoResources.spPortalClientId}`);
    
    // ========================================
    // STEP 3.5: Create Per-Tenant Tables
    // ========================================
    console.log('\n[STEP 3.5/7] Creating per-tenant DynamoDB tables...');
    const tenantTables = await createTenantTables(tenantData.tenantId);
    provisioningLog.push({ 
      step: 'tables', 
      data: tenantTables 
    });
    console.log('[STEP 3.5/7] ✓ Per-tenant tables created');
    console.log(`[STEP 3.5/7]   AuthCode: ${tenantTables.authCodeTable}`);
    console.log(`[STEP 3.5/7]   SessionId: ${tenantTables.sessionIdTable}`);
    console.log(`[STEP 3.5/7]   TotpToken: ${tenantTables.totpTokenTable}`);
    console.log(`[STEP 3.5/7]   PwdHash: ${tenantTables.pwdHashTable}`);
    
    // ========================================
    // STEP 4: Generate Config Files
    // ========================================
    console.log('\n[STEP 4/7] Generating and uploading configuration files...');
    const configUrls = await generateAndUploadConfigs(tenantData, cognitoResources);
    provisioningLog.push({ 
      step: 'config', 
      data: { ...configUrls, tenantId: tenantData.tenantId } 
    });
    console.log('[STEP 4/7] ✓ Configuration files uploaded');
    console.log(`[STEP 4/7]   AWS Config: ${configUrls.awsConfig}`);
    console.log(`[STEP 4/7]   Branding: ${configUrls.branding}`);
    
    // ========================================
    // STEP 5: Save to DynamoDB
    // ========================================
    console.log('\n[STEP 5/7] Saving tenant to DynamoDB...');
    await saveTenantToDynamoDB(tenantData, cognitoResources, asmData, tenantTables);
    provisioningLog.push({ 
      step: 'dynamodb', 
      data: { tenantId: tenantData.tenantId } 
    });
    console.log('[STEP 5/7] ✓ Tenant saved to database');
    
    // ========================================
    // STEP 6: Success Response
    // ========================================
    const duration = Date.now() - startTime;
    console.log('\n' + '='.repeat(80));
    console.log(`[SUCCESS] Tenant '${tenantData.tenantId}' provisioned successfully in ${duration}ms`);
    console.log('='.repeat(80));
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        message: `Tenant '${tenantData.tenantId}' provisioned successfully`,
        data: {
          tenantId: tenantData.tenantId,
          tenantName: tenantData.tenantName,
          orgId: tenantData.orgId,
          url: configUrls.tenantUrl,
          userPoolId: cognitoResources.userPoolId,
          spPortalClientId: cognitoResources.spPortalClientId,
          awsConfigUrl: configUrls.awsConfig,
          brandingUrl: configUrls.branding,
          provisioningTime: `${duration}ms`,
          status: 'active'
        }
      })
    };
    
  } catch (error) {
    // ========================================
    // ERROR HANDLING & ROLLBACK
    // ========================================
    const duration = Date.now() - startTime;
    console.error('\n' + '='.repeat(80));
    console.error('[ERROR] Tenant provisioning failed:', error);
    console.error('='.repeat(80));
    
    // Perform rollback
    console.log('\n[ROLLBACK] Initiating rollback of provisioned resources...');
    try {
      await rollbackProvisioning(provisioningLog);
      
      // Validate rollback if we have a tenant ID
      if (tenantData?.tenantId) {
        const rollbackResults = await validateRollback(tenantData.tenantId);
        console.log('[ROLLBACK] Validation results:', rollbackResults);
      }
      
      console.log('[ROLLBACK] ✓ Rollback completed successfully');
      
    } catch (rollbackError) {
      console.error('[ROLLBACK] ✗ Rollback encountered errors:', rollbackError);
      // Continue to return error response
    }
    
    // Determine status code
    const statusCode = error.statusCode || 500;
    
    // Return error response
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        message: 'Tenant provisioning failed',
        error: error.message,
        tenantId: tenantData?.tenantId,
        provisioningTime: `${duration}ms`,
        rollbackPerformed: true,
        // Include validation errors if present
        ...(error.validationErrors && { validationErrors: error.validationErrors })
      })
    };
  }
};

/**
 * Health check handler (for testing)
 */
export const healthCheck = async () => {
  return {
    statusCode: 200,
    body: JSON.stringify({
      status: 'healthy',
      service: 'tenant-provisioning-lambda',
      version: '2.0.0',
      timestamp: new Date().toISOString()
    })
  };
};

export default handler;
