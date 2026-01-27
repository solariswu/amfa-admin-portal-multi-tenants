/* eslint-disable import/no-extraneous-dependencies */
import {
	Certificate,
	CertificateValidation,
} from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone, PublicHostedZone } from 'aws-cdk-lib/aws-route53';

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { current_stage } from '../config';

interface CertificateResourcesProps {
	domain: string;
	hostedZoneId: string;
}

interface CertificateStackProps extends StackProps {
	domain: string;
	hostedZoneId: string | undefined;
}

export class CertificateStack extends Stack {
	siteCertificate: Certificate;
	hostedZone: PublicHostedZone;

	constructor(scope: Construct, id: string, props: CertificateStackProps) {
		super(scope, id, props);

		const certificateResources = new CertificateResources(this, `certificate-${current_stage}`, {
			domain: props.domain,
			hostedZoneId: props.hostedZoneId ? props.hostedZoneId : '',
		});

		this.siteCertificate = certificateResources.siteCertificate;
		this.hostedZone = certificateResources.hostedZone;

	}
}

export class CertificateResources extends Construct {
	public readonly siteCertificate: Certificate;
	public readonly hostedZone: PublicHostedZone;

	constructor(scope: Construct, id: string, props: CertificateResourcesProps) {
		super(scope, id);

		this.hostedZone = HostedZone.fromHostedZoneAttributes(this, `hostedZone-${current_stage}-${props.domain}`, {
			zoneName: props.domain,
			hostedZoneId: props.hostedZoneId,
		}) as PublicHostedZone;

		this.siteCertificate = new Certificate(this, `siteCertificate-${current_stage}-${props.domain}`, {
			domainName: props.domain,
			validation: CertificateValidation.fromDns(this.hostedZone),
		});
	}
}
