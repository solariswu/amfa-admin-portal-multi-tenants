import { Construct } from 'constructs';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { PublicHostedZone, ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import {
  Distribution,
  OriginAccessIdentity,
  ViewerProtocolPolicy,
  AllowedMethods,
  CachedMethods,
  CachePolicy,
  OriginRequestPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Bucket, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { RemovalPolicy } from 'aws-cdk-lib';

export interface SPPortalWebAppProps {
  certificate: Certificate;
  hostedZone: PublicHostedZone;
  tenantId: string;
  domainName: string; // login.<tenant-id>.<root-domain>
  assetsPath?: string;
}

export class SPPortalWebApp extends Construct {
  public readonly s3bucket: Bucket;
  public readonly distribution: Distribution;
  public readonly domainName: string;

  constructor(scope: Construct, id: string, props: SPPortalWebAppProps) {
    super(scope, id);

    this.domainName = props.domainName;

    // Create S3 bucket for SP portal static assets
    this.s3bucket = new Bucket(this, `SPPortalBucket-${props.tenantId}`, {
      bucketName: `sp-portal-${props.tenantId}-${Math.random().toString(36).substring(7)}`,
      accessControl: BucketAccessControl.PRIVATE,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create Origin Access Identity for CloudFront
    const originAccessIdentity = new OriginAccessIdentity(this, `SPPortalOAI-${props.tenantId}`, {
      comment: `OAI for SP Portal ${props.tenantId}`,
    });

    // Grant CloudFront access to S3 bucket
    this.s3bucket.grantRead(originAccessIdentity);

    // Create CloudFront distribution
    this.distribution = new Distribution(this, `SPPortalDistribution-${props.tenantId}`, {
      defaultBehavior: {
        origin: new S3Origin(this.s3bucket, {
          originAccessIdentity: originAccessIdentity,
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
      },
      domainNames: [props.domainName],
      certificate: props.certificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // Create DNS record
    new ARecord(this, `SPPortalARecord-${props.tenantId}`, {
      zone: props.hostedZone,
      recordName: props.domainName,
      target: RecordTarget.fromAlias(new CloudFrontTarget(this.distribution)),
    });

    // Deploy SP portal assets if path is provided
    if (props.assetsPath) {
      new BucketDeployment(this, `SPPortalDeployment-${props.tenantId}`, {
        sources: [Source.asset(props.assetsPath)],
        destinationBucket: this.s3bucket,
        distribution: this.distribution,
        distributionPaths: ['/*'],
      });
    }
  }
}
