import { Construct } from "constructs";
import { TriggerFunction } from "aws-cdk-lib/triggers";

import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";

import {
  current_stage,
  samlproxy_base_url,
  stage_config,
  suapi_endpoint,
  AMFATENANT_TABLE,
} from "../config";

export const createPostDeploymentLambda = (
  scope: Construct,
  adminPoolId: string,
  clientId: string,
  samlClientId: string,
) => {
  const lambdaName = "postdeployment";
  const initLambda = new TriggerFunction(scope, "CDKPostDeploymentLambda", {
    runtime: Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: Code.fromAsset(`cdk/lambda/${lambdaName}`),
    environment: {
      AMFATENANT_TABLE: AMFATENANT_TABLE,
      ADMINPOOL_ID: adminPoolId,
      CLIENT_ID: clientId,
      SAML_CLIENT_ID: samlClientId,
      SAML_CALLBACK_URL: samlproxy_base_url + samlClientId,
      ROOT_DOMAIN_NAME: stage_config[current_stage].domainName,
      ADMIN_EMAIL: process.env.ADMIN_EMAIL || "admin@example.com",
      SUAPI_ENDPOINT: suapi_endpoint,
    },
    timeout: Duration.minutes(5),
  });

  initLambda.role?.attachInlinePolicy(
    new Policy(scope, `${lambdaName}-lambda-policy`, {
      statements: [
        new PolicyStatement({
          actions: ["iam:PassRole"],
          resources: [
            `arn:aws:iam::${stage_config[current_stage].env.account}:role/AmfaStack-*`,
          ],
        }),
        new PolicyStatement({
          actions: [
            "cognito-idp:SetUICustomization",
            "cognito-idp:DescribeUserPool",
            "cognito-idp:UpdateUserPool",
            "cognito-idp:CreateIdentityProvider",
            "cognito-idp:DescribeUserPoolClient",
            "cognito-idp:UpdateUserPoolClient",
            "cognito-idp:AdminCreateUser",
            "cognito-idp:CreateGroup",
          ],
          resources: [
            `arn:aws:cognito-idp:${stage_config[current_stage].env.region}:*:userpool/${adminPoolId}`,
            `arn:aws:cognito-idp:${stage_config[current_stage].env.region}:*:userpool/*`,
          ],
        }),
        new PolicyStatement({
          actions: ["dynamodb:Scan", "dynamodb:GetItem"],
          resources: [
            `arn:aws:dynamodb:${stage_config[current_stage].env.region}:*:table/${AMFATENANT_TABLE}`,
          ],
        }),
      ],
    }),
  );
};
