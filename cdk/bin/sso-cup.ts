#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { CertificateStack } from '../lib/certificate';
import { AppStack } from '../lib/application';
import { stage_config, current_stage, hostedUI_domain_prefix, amfa_api_base } from '../config';

const app = new App();

const certEnv = {
	account: stage_config[current_stage].env.account,
	region: 'us-east-1',
};

// certificate stack shall be in us-east-1, using for web app
const certStack222 = new CertificateStack(app, 'CertStack222', {
	env: certEnv,
	domain: `${stage_config[current_stage].domainName}`,
	hostedZoneId: stage_config[current_stage].hostedZoneId,
});

// api cert shall be in the same region as the api
const apiCertStack = new CertificateStack(app, 'APICertificateStack', {
	env: stage_config[current_stage].env,
	domain: `api.${stage_config[current_stage].domainName}`,
	hostedZoneId: stage_config[current_stage].hostedZoneId,
});

new AppStack(app, 'SSO-CUPStack', {
	siteCertificate: certStack222.siteCertificate,
	apiCertificate: apiCertStack.siteCertificate,
	hostedUIDomain: hostedUI_domain_prefix,
	hostedZone: certStack222.hostedZone,
	...stage_config[current_stage],
	crossRegionReferences: stage_config[current_stage].env.region !== 'us-east-1',
	assetsPath: '../../dist',
	amfaBaseUrl: amfa_api_base,
});

app.synth();
