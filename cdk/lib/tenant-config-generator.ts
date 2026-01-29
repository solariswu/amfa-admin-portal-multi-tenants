import { Construct } from 'constructs';
import { CustomResource, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IDistribution } from 'aws-cdk-lib/aws-cloudfront';
import * as path from 'path';

export interface TenantConfigGeneratorProps {
  /**
   * Tenant ID
   */
  tenantId: string;

  /**
   * Tenant data from DynamoDB
   */
  tenantData: {
    tenantName: string;
    userPoolId: string;
    clientId: string;
    oauthDomain: string;
    region: string;
  };

  /**
   * Shared S3 bucket for all SP portal files
   */
  spPortalBucket: IBucket;

  /**
   * Shared CloudFront distribution
   */
  spPortalDistribution: IDistribution;

  /**
   * Root domain name
   */
  rootDomain: string;

  /**
   * Default branding configuration from CDK config
   */
  defaultBranding?: {
    logo?: string;
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
    companyNameOverride?: string;
  };

  /**
   * AWS region
   */
  region: string;

  /**
   * AWS account ID
   */
  account: string;
}

/**
 * Tenant Configuration Generator
 * 
 * Generates and uploads tenant-specific configuration files to S3:
 * - awsconfig_<tenantId>.json - AWS/Cognito configuration
 * - branding_<tenantId>.json - UI branding configuration
 * 
 * These files are loaded dynamically by the SP portal based on the subdomain.
 */
export class TenantConfigGenerator extends Construct {
  public readonly customResource: CustomResource;

  constructor(scope: Construct, id: string, props: TenantConfigGeneratorProps) {
    super(scope, id);

    // Create Lambda to generate and upload config files
    const generatorLambda = new Function(this, 'ConfigGeneratorFunction', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: Code.fromInline(`
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');

const s3 = new S3Client({});
const cloudfront = new CloudFrontClient({});

exports.handler = async (event) => {
  console.log('Config Generator invoked:', JSON.stringify(event, null, 2));
  
  const requestType = event.RequestType;
  const props = event.ResourceProperties;
  
  if (requestType === 'Delete') {
    // On delete, optionally remove config files
    return { Status: 'SUCCESS', PhysicalResourceId: props.TenantId };
  }
  
  try {
    const tenantId = props.TenantId;
    const tenantData = JSON.parse(props.TenantData);
    const defaultBranding = JSON.parse(props.DefaultBranding || '{}');
    
    // Generate awsconfig_<tenantId>.json
    const awsConfig = {
      ProjectRegion: tenantData.region,
      EndUserPoolId: tenantData.userPoolId,
      EndUserAppClientId: tenantData.clientId,
      OAuthDomainName: tenantData.oauthDomain,
      AdminAPIUrl: \`https://api.adminportal.\${props.RootDomain}\`,
      AmfaServiceDomain: \`\${tenantId}.\${props.RootDomain}\`,
    };
    
    // Generate branding_<tenantId>.json
    const branding = {
      logo: defaultBranding.logo || '/logo.png',
      primaryColor: defaultBranding.primaryColor || '#007bff',
      secondaryColor: defaultBranding.secondaryColor || '#6c757d',
      fontFamily: defaultBranding.fontFamily || 'Arial, sans-serif',
      companyName: defaultBranding.companyNameOverride || tenantData.tenantName,
      favicon: defaultBranding.favicon || '/favicon.ico',
    };
    
    // Upload awsconfig file
    await s3.send(new PutObjectCommand({
      Bucket: props.BucketName,
      Key: \`awsconfig_\${tenantId}.json\`,
      Body: JSON.stringify(awsConfig, null, 2),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300', // 5 minutes cache
    }));
    
    console.log(\`Uploaded awsconfig_\${tenantId}.json\`);
    
    // Upload branding file
    await s3.send(new PutObjectCommand({
      Bucket: props.BucketName,
      Key: \`branding_\${tenantId}.json\`,
      Body: JSON.stringify(branding, null, 2),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=3600', // 1 hour cache
    }));
    
    console.log(\`Uploaded branding_\${tenantId}.json\`);
    
    // Invalidate CloudFront cache for these files
    await cloudfront.send(new CreateInvalidationCommand({
      DistributionId: props.DistributionId,
      InvalidationBatch: {
        CallerReference: \`\${tenantId}-\${Date.now()}\`,
        Paths: {
          Quantity: 2,
          Items: [
            \`/awsconfig_\${tenantId}.json\`,
            \`/branding_\${tenantId}.json\`,
          ],
        },
      },
    }));
    
    console.log('CloudFront cache invalidated');
    
    return {
      Status: 'SUCCESS',
      PhysicalResourceId: tenantId,
      Data: {
        AwsConfigUrl: \`https://\${tenantId}.\${props.RootDomain}/awsconfig_\${tenantId}.json\`,
        BrandingUrl: \`https://\${tenantId}.\${props.RootDomain}/branding_\${tenantId}.json\`,
      },
    };
    
  } catch (error) {
    console.error('Config generation failed:', error);
    return {
      Status: 'FAILED',
      PhysicalResourceId: props.TenantId,
      Reason: error.message,
    };
  }
};
      `),
      timeout: Duration.minutes(5),
      memorySize: 256,
      description: `Generate config files for tenant ${props.tenantId}`,
    });

    // Grant S3 permissions
    props.spPortalBucket.grantPut(generatorLambda);
    props.spPortalBucket.grantRead(generatorLambda);

    // Grant CloudFront invalidation permissions
    generatorLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${props.account}:distribution/${props.spPortalDistribution.distributionId}`,
        ],
      })
    );

    // Create custom resource provider
    const provider = new Provider(this, 'ConfigGeneratorProvider', {
      onEventHandler: generatorLambda,
    });

    // Create custom resource
    this.customResource = new CustomResource(this, 'ConfigGeneratorResource', {
      serviceToken: provider.serviceToken,
      properties: {
        TenantId: props.tenantId,
        TenantData: JSON.stringify(props.tenantData),
        BucketName: props.spPortalBucket.bucketName,
        DistributionId: props.spPortalDistribution.distributionId,
        RootDomain: props.rootDomain,
        DefaultBranding: JSON.stringify(props.defaultBranding || {}),
        // Force update on each deployment
        Timestamp: Date.now(),
      },
    });
  }

  /**
   * Get the AWS config URL for this tenant
   */
  public getAwsConfigUrl(): string {
    return this.customResource.getAttString('AwsConfigUrl');
  }

  /**
   * Get the branding URL for this tenant
   */
  public getBrandingUrl(): string {
    return this.customResource.getAttString('BrandingUrl');
  }
}
