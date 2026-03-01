/**
 * Configuration Generator Module
 * 
 * Generates and uploads tenant-specific configuration files to shared S3 bucket:
 * - awsconfig_<tenantId>.json - AWS/Cognito configuration
 * - branding_<tenantId>.json - UI branding configuration
 * 
 * Also invalidates CloudFront cache for immediate availability.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const cloudfront = new CloudFrontClient({ region: process.env.AWS_REGION });

/**
 * Generate and upload tenant configuration files
 * 
 * @param {Object} tenantData - Validated tenant data
 * @param {Object} cognitoResources - Cognito resource IDs
 * @returns {Object} URLs to uploaded configuration files
 */
export async function generateAndUploadConfigs(tenantData, cognitoResources) {
  const { tenantId, tenantName } = tenantData;
  
  console.log(`[Config] Generating configuration files for tenant: ${tenantId}`);
  
  // 1. Generate awsconfig.json
  const awsConfig = generateAWSConfig(tenantId, tenantName, cognitoResources);
  console.log(`[Config] Generated awsconfig for ${tenantId}`);
  
  // 2. Generate branding.json with defaults
  const branding = generateBranding(tenantId, tenantName);
  console.log(`[Config] Generated branding for ${tenantId}`);
  
  // 3. Upload both files to S3
  await uploadConfigToS3(tenantId, 'awsconfig', awsConfig);
  console.log(`[Config] Uploaded awsconfig_${tenantId}.json to S3`);
  
  await uploadConfigToS3(tenantId, 'branding', branding);
  console.log(`[Config] Uploaded branding_${tenantId}.json to S3`);
  
  // 4. Invalidate CloudFront cache
  await invalidateCloudFrontCache(tenantId);
  console.log(`[Config] Invalidated CloudFront cache for ${tenantId}`);
  
  // 5. Return URLs
  const rootDomain = process.env.ROOT_DOMAIN_NAME;
  return {
    awsConfig: `https://${tenantId}.login.${rootDomain}/awsconfig_${tenantId}.json`,
    branding: `https://${tenantId}.login.${rootDomain}/branding_${tenantId}.json`,
    tenantUrl: `https://${tenantId}.login.${rootDomain}`
  };
}

/**
 * Generate AWS configuration JSON
 */
function generateAWSConfig(tenantId, tenantName, cognitoResources) {
  const rootDomain = process.env.ROOT_DOMAIN_NAME;
  const region = process.env.AWS_REGION;
  
  return {
    ProjectRegion: region,
    EndUserPoolId: cognitoResources.userPoolId,
    EndUserAppClientId: cognitoResources.spPortalClientId,
    OAuthDomainName: cognitoResources.oauthDomain,
    AdminAPIUrl: `https://api.adminportal.${rootDomain}`,
    AmfaServiceDomain: `${tenantId}.${rootDomain}`,
    TenantId: tenantId,
    TenantName: tenantName,
    // Additional metadata
    _meta: {
      version: '2.0',
      generatedAt: new Date().toISOString(),
      architecture: 'multi-tenant-shared-infrastructure'
    }
  };
}

/**
 * Generate branding configuration JSON with defaults from environment
 */
function generateBranding(tenantId, tenantName) {
  return {
    // Company branding
    companyName: tenantName,
    logo: process.env.DEFAULT_LOGO || '/logo.png',
    favicon: process.env.DEFAULT_FAVICON || '/favicon.ico',
    
    // Color scheme
    primaryColor: process.env.DEFAULT_PRIMARY_COLOR || '#007bff',
    secondaryColor: process.env.DEFAULT_SECONDARY_COLOR || '#6c757d',
    successColor: process.env.DEFAULT_SUCCESS_COLOR || '#28a745',
    warningColor: process.env.DEFAULT_WARNING_COLOR || '#ffc107',
    dangerColor: process.env.DEFAULT_DANGER_COLOR || '#dc3545',
    infoColor: process.env.DEFAULT_INFO_COLOR || '#17a2b8',
    
    // Typography
    fontFamily: process.env.DEFAULT_FONT_FAMILY || 'Arial, sans-serif',
    headingFontFamily: process.env.DEFAULT_HEADING_FONT_FAMILY || 'Arial, sans-serif',
    fontSize: process.env.DEFAULT_FONT_SIZE || '14px',
    
    // Layout
    borderRadius: process.env.DEFAULT_BORDER_RADIUS || '4px',
    boxShadow: process.env.DEFAULT_BOX_SHADOW || '0 2px 4px rgba(0,0,0,0.1)',
    
    // Additional metadata
    _meta: {
      version: '2.0',
      generatedAt: new Date().toISOString(),
      tenantId: tenantId,
      customizable: true
    }
  };
}

/**
 * Upload configuration file to S3
 */
async function uploadConfigToS3(tenantId, configType, configData) {
  const bucketName = process.env.SP_PORTAL_BUCKET;
  
  if (!bucketName) {
    throw new Error('SP_PORTAL_BUCKET environment variable is not set');
  }
  
  const fileName = `${configType}_${tenantId}.json`;
  const cacheControl = configType === 'awsconfig' 
    ? 'public, max-age=300' // 5 minutes for awsconfig
    : 'public, max-age=3600'; // 1 hour for branding
  
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: JSON.stringify(configData, null, 2),
    ContentType: 'application/json',
    CacheControl: cacheControl,
    Metadata: {
      'tenant-id': tenantId,
      'config-type': configType,
      'generated-at': new Date().toISOString()
    }
  });
  
  try {
    await s3.send(command);
  } catch (error) {
    console.error(`[Config] Failed to upload ${fileName} to S3:`, error);
    throw new Error(`Failed to upload ${configType} config: ${error.message}`);
  }
}

/**
 * Invalidate CloudFront cache for tenant config files
 */
async function invalidateCloudFrontCache(tenantId) {
  const distributionId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
  
  if (!distributionId) {
    console.warn('[Config] CLOUDFRONT_DISTRIBUTION_ID not set, skipping cache invalidation');
    return;
  }
  
  const command = new CreateInvalidationCommand({
    DistributionId: distributionId,
    InvalidationBatch: {
      CallerReference: `tenant-${tenantId}-${Date.now()}`,
      Paths: {
        Quantity: 2,
        Items: [
          `/awsconfig_${tenantId}.json`,
          `/branding_${tenantId}.json`
        ]
      }
    }
  });
  
  try {
    const response = await cloudfront.send(command);
    console.log(`[Config] CloudFront invalidation created: ${response.Invalidation.Id}`);
  } catch (error) {
    console.error('[Config] Failed to invalidate CloudFront cache:', error);
    // Don't fail provisioning if cache invalidation fails
    console.warn('[Config] Continuing without cache invalidation - configs may take time to propagate');
  }
}

/**
 * Delete config files from S3 (used during rollback)
 */
export async function deleteConfigFiles(tenantId) {
  const bucketName = process.env.SP_PORTAL_BUCKET;
  
  if (!bucketName) {
    console.warn('[Config] SP_PORTAL_BUCKET not set, skipping config deletion');
    return;
  }
  
  console.log(`[Config] Deleting configuration files for tenant: ${tenantId}`);
  
  // Import DeleteObjectCommand here to avoid loading it unless needed
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  
  try {
    // Delete awsconfig
    await s3.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: `awsconfig_${tenantId}.json`
    }));
    
    // Delete branding
    await s3.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: `branding_${tenantId}.json`
    }));
    
    console.log(`[Config] Deleted configuration files for ${tenantId}`);
    
    // Invalidate cache for deleted files
    await invalidateCloudFrontCache(tenantId);
    
  } catch (error) {
    console.error(`[Config] Error deleting config files:`, error);
    // Don't throw - this is cleanup, continue with other rollback steps
  }
}

export default generateAndUploadConfigs;
