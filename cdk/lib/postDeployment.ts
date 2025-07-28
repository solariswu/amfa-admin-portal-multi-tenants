import { Construct } from 'constructs';
import { TriggerFunction } from 'aws-cdk-lib/triggers';

import { Code, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Duration } from 'aws-cdk-lib';

import * as path from 'path';

import { current_stage, samlproxy_base_url, stage_config, suapi_endpoint } from '../config';

export const createPostDeploymentLambda = (
    scope: Construct,
    userPoolId: string,
    adminPoolId: string,
    clientId: string,
    samlClientId: string,
) => {

    const lambdaName = 'postdeployment';
    const initLambda = new TriggerFunction(scope, 'CDKPostDeploymentLambda', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: Code.fromAsset(path.join(__dirname + `/../lambda/${lambdaName}`)),
        environment: {
            USERPOOL_ID: userPoolId,
            ADMINPOOL_ID: adminPoolId,
            CLIENT_ID: clientId,
            SAML_CLIENT_ID: samlClientId,
            SAML_CALLBACK_URL: samlproxy_base_url + samlClientId,
            ROOT_DOMAIN_NAME: stage_config[current_stage].domainName,
            TENANT_ID: process.env.TENANT_ID? process.env.TENANT_ID : 'unknown',
            ADMIN_EMAIL: process.env.ADMIN_EMAIL? process.env.ADMIN_EMAIL : 'unknown',
            SUAPI_ENDPOINT: suapi_endpoint,
        },
        timeout: Duration.minutes(5),
    });

    initLambda.role?.attachInlinePolicy(
        new Policy(scope, `${lambdaName}-lambda-policy`, {
            statements: [
                new PolicyStatement({
                    actions: [
                        'iam:PassRole'
                    ],
                    resources: [`arn:aws:iam::${stage_config[current_stage].env.account}:role/AmfaStack-*`],
                }),
                new PolicyStatement({
                    actions: [
                        'cognito-idp:SetUICustomization',
                        'cognito-idp:AdminCreateUser',
                        'cognito-idp:DescribeUserPool',
						'cognito-idp:UpdateUserPool',
                        'cognito-idp:CreateIdentityProvider'
                    ],
                    resources: [`arn:aws:cognito-idp:${stage_config[current_stage].env.region}:*:userpool/${adminPoolId}`],
                }),
                new PolicyStatement({
                    actions: [
                        'cognito-idp:DescribeUserPoolClient',
                        'cognito-idp:UpdateUserPoolClient',
                    ],
                    resources: [`arn:aws:cognito-idp:${stage_config[current_stage].env.region}:*:userpool/${userPoolId}`],
                }),
            ],
        })
    );
};
