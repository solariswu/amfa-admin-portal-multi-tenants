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
 * 
 * Field names must match what the SP Portal frontend expects:
 * - aws_project_region, aws_user_pools_id, aws_user_pools_web_client_id,
 *   aws_oauth_domain, apiUrl, amfa_service_domain
 */
function generateAWSConfig(tenantId, tenantName, cognitoResources) {
  const rootDomain = process.env.ROOT_DOMAIN_NAME;
  const region = process.env.AWS_REGION;
  
  return {
    aws_project_region: region,
    aws_user_pools_id: cognitoResources.userPoolId,
    aws_user_pools_web_client_id: cognitoResources.spPortalClientId,
    aws_oauth_domain: cognitoResources.oauthDomain,
    apiUrl: `https://api.${rootDomain}`,
    amfa_service_domain: `${tenantId}.idapersona.${rootDomain}`,
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
 * Generate branding configuration JSON with defaults from environment.
 * 
 * Field names must match what the SP Portal frontend expects
 * (App.jsx, LoginPage.jsx, ServiceProvidersList.jsx).
 */
function generateBranding(tenantId, tenantName) {
  return {
    id: tenantId,
    name: tenantName,

    // App title and logo URLs
    app_title_msg: tenantName || 'End User Portal',
    app_login_logo_url: process.env.DEFAULT_LOGIN_LOGO || 'https://downloads.apersona.com/logos/logo-here_250x50.png',
    fav_icon_url: process.env.DEFAULT_FAVICON || 'https://downloads.apersona.com/logos/favicon.png',
    app_bar_logo_url: process.env.DEFAULT_BAR_LOGO || 'https://downloads.apersona.com/logos/logo-here_white_250x50.png',
    app_terms_url: process.env.DEFAULT_TERMS_URL || 'https://www.apersona.com/licensing',
    app_privacy_url: process.env.DEFAULT_PRIVACY_URL || 'https://www.apersona.com/privacy',

    // Color scheme (matching frontend expectations)
    login_page_center_color: process.env.DEFAULT_LOGIN_CENTER_COLOR || '#808080',
    login_page_outter_color: process.env.DEFAULT_LOGIN_OUTER_COLOR || '#9B9B9B',
    app_bar_start_color: process.env.DEFAULT_BAR_START_COLOR || '#083173',
    app_bar_end_color: process.env.DEFAULT_BAR_END_COLOR || '#083173',
    app_title_icon_color: process.env.DEFAULT_TITLE_ICON_COLOR || '#F9F9F9',

    // Portal content
    portal_title_msg: process.env.DEFAULT_PORTAL_TITLE || 'Service Providers',
    portal_description_msg: process.env.DEFAULT_PORTAL_DESC || 'All available single sign-on services are listed below. Remove any that you do not personally use.',

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
