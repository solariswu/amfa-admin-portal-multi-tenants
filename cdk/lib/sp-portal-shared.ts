import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { 
  Bucket, 
  BucketAccessControl, 
  BlockPublicAccess,
  BucketEncryption,
  HttpMethods
} from 'aws-cdk-lib/aws-s3';
import { 
  Distribution, 
  OriginAccessIdentity, 
  ViewerProtocolPolicy,
  AllowedMethods,
  CachePolicy,
  OriginRequestPolicy,
  PriceClass
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { 
  ARecord, 
  RecordTarget, 
  IHostedZone 
} from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';

export interface SPPortalSharedProps {
  /**
   * Root domain name (e.g., example.com)
   * Tenants will be accessed at <tenantId>.example.com
   */
  rootDomain: string;

  /**
   * Route53 hosted zone for DNS
   */
  hostedZone: IHostedZone;

  /**
   * Wildcard SSL certificate for *.example.com
   */
  certificate: ICertificate;

  /**
   * Path to SP portal static assets
   */
  assetsPath?: string;

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
 * Shared SP Portal Infrastructure for Multi-Tenant Access
 * 
 * This construct creates:
 * 1. Single S3 bucket for all tenant SP portal files
 * 2. Single CloudFront distribution with wildcard domain (*.example.com)
 * 3. Wildcard DNS record to route all subdomains to CloudFront
 * 
 * Each tenant gets:
 * - URL: <tenantId>.example.com
 * - Config files: awsconfig_<tenantId>.json, branding_<tenantId>.json
 * 
 * The SP portal dynamically loads configuration based on the subdomain.
 */
export class SPPortalShared extends Construct {
  public readonly s3bucket: Bucket;
  public readonly distribution: Distribution;
  public readonly originAccessIdentity: OriginAccessIdentity;

  constructor(scope: Construct, id: string, props: SPPortalSharedProps) {
    super(scope, id);

    // Create single S3 bucket for all tenants
    this.s3bucket = new Bucket(this, 'SPPortalSharedBucket', {
      bucketName: `sp-portal-shared-${props.account}-${props.region}`,
      accessControl: BucketAccessControl.PRIVATE,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [
            HttpMethods.GET,
            HttpMethods.HEAD
          ],
          allowedOrigins: [
            `https://*.${props.rootDomain}`,
            `https://${props.rootDomain}`
          ],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      versioned: false,
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
    });

    // Create Origin Access Identity for CloudFront
    this.originAccessIdentity = new OriginAccessIdentity(this, 'SPPortalSharedOAI', {
      comment: `OAI for Shared SP Portal - ${props.rootDomain}`,
    });

    // Grant read access to OAI
    this.s3bucket.grantRead(this.originAccessIdentity);

    // Create single CloudFront distribution with wildcard domain
    this.distribution = new Distribution(this, 'SPPortalSharedDistribution', {
      comment: `Shared SP Portal for all tenants - ${props.rootDomain}`,
      defaultRootObject: 'index.html',
      domainNames: [
        `*.${props.rootDomain}`, // Wildcard for all tenant subdomains
      ],
      certificate: props.certificate,
      defaultBehavior: {
        origin: new S3Origin(this.s3bucket, {
          originAccessIdentity: this.originAccessIdentity,
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
        compress: true,
      },
      // Error responses for SPA
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
      ],
      enableLogging: true,
      logIncludesCookies: true,
      priceClass: PriceClass.PRICE_CLASS_100, // Use only North America and Europe
    });

    // Create wildcard DNS A record
    // This routes ALL subdomains (*.example.com) to the CloudFront distribution
    new ARecord(this, 'SPPortalWildcardRecord', {
      zone: props.hostedZone,
      recordName: '*', // Wildcard - matches any subdomain
      target: RecordTarget.fromAlias(
        new CloudFrontTarget(this.distribution)
      ),
      comment: 'Wildcard record for multi-tenant SP portal',
    });

    // Deploy SP portal static assets if provided
    if (props.assetsPath) {
      new BucketDeployment(this, 'SPPortalStaticAssets', {
        sources: [Source.asset(props.assetsPath)],
        destinationBucket: this.s3bucket,
        distribution: this.distribution,
        distributionPaths: ['/*'],
        memoryLimit: 512,
        prune: false, // Don't delete tenant config files
      });
    }
  }

  /**
   * Get the CloudFront distribution URL
   */
  public getDistributionUrl(): string {
    return `https://${this.distribution.distributionDomainName}`;
  }

  /**
   * Get tenant-specific URL
   */
  public getTenantUrl(tenantId: string, rootDomain: string): string {
    return `https://${tenantId}.${rootDomain}`;
  }
}
