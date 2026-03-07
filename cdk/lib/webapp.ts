
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { ARecord, PublicHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";

import { Bucket, BucketAccessControl } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Distribution, OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';

import { RemovalPolicy, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";

import { current_stage, project_name, service_name } from "../config";
import * as path from 'path';
import { AppStackProps } from "./application";


export class WebApplication {
	scope: Construct
	domainName: string;
	certificate: Certificate;
	hostedZoneId: string;
	aRecord: ARecord;
	s3bucket: Bucket;
	distribution: Distribution;
	account: string | undefined;
	region: string | undefined;
	assetsPath: string;

	constructor(scope: Construct, props: AppStackProps) {
		this.scope = scope;
		this.domainName = props.domainName ? props.domainName : '';
		this.certificate = props.siteCertificate;
		this.hostedZoneId = props.hostedZoneId ? props.hostedZoneId : '';
		this.account = props.env?.account;
		this.region = props.env?.region;
		this.assetsPath = props.assetsPath;

		this.s3bucket = this.createS3Bucket(service_name);
		this.distribution = this.createDistribution(this.s3bucket);
		this.aRecord = this.createRoute53ARecord(this.distribution);

	}

	/**
	 * Deploy assets to S3 and invalidate CloudFront.
	 * Call this after all resources (userPool, etc.) are created,
	 * so additional sources (like amfaext.js) can reference CDK tokens.
	 * 
	 * @param additionalSources - Extra Source objects to include alongside dist/
	 */
	public deployAssets(additionalSources: import("aws-cdk-lib/aws-s3-deployment").ISource[] = []) {
		const name = 'BucketDeployment-main';
		new BucketDeployment(this.scope, name, {
			destinationBucket: this.s3bucket,
			sources: [
				Source.asset(path.resolve(__dirname, this.assetsPath)),
				...additionalSources,
			],
			distribution: this.distribution,
			distributionPaths: ['/*'],
		});
	}

	private createS3Bucket(name: string) {
		return new Bucket(this.scope, `${project_name}-${this.region}-${current_stage}-WebAppDeployBucket-${name}`, {
			bucketName: `${this.account}-${this.region}-${project_name}-${name}-web`,
			accessControl: BucketAccessControl.PRIVATE,
			removalPolicy: RemovalPolicy.DESTROY,
		});
	}

	private createDistribution(bucket: Bucket) {
		// config Cloudfront read to S3
		let name = 'OriginAccessIdentity-main';
		const originAccessIdentity = new OriginAccessIdentity(
			this.scope,
			name
		);
		bucket.grantRead(originAccessIdentity);

		// set up cloudfront
		name = 'Distribution-main';

		const distribution = new Distribution(this.scope, name, {
			defaultRootObject: 'index.html',
			domainNames: [this.domainName],
			certificate:  this.certificate,
			defaultBehavior: {
				origin: S3BucketOrigin.withOriginAccessControl(bucket)//new S3BucketOrigin(bucket),
			},
			errorResponses: [{
				httpStatus: 403,
				responseHttpStatus: 200,
				responsePagePath: '/index.html',
				ttl: Duration.minutes(5),
			}, {
				httpStatus: 404,
				responseHttpStatus: 200,
				responsePagePath: '/index.html',
				ttl: Duration.minutes(5),
			}],
		});

		return distribution;
	}

	private createRoute53ARecord(distribution: Distribution): ARecord {
		const name = `${project_name}-${current_stage}-Route53ARecordSet-main`;
		return new ARecord(this.scope, name, {
			zone: PublicHostedZone.fromPublicHostedZoneAttributes(this.scope, `apiHostedZone-${current_stage}-main`, {
				hostedZoneId: this.hostedZoneId,
				zoneName: this.domainName,
			}),
			recordName: this.domainName,
			target: RecordTarget.fromAlias(
				new CloudFrontTarget(distribution)
			),
		});
	}

}
