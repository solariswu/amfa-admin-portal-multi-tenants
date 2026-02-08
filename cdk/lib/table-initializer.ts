import { Construct } from 'constructs';
import { Duration, CustomResource } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';

export interface TableInitializerProps {
  /**
   * The DynamoDB table to initialize
   */
  table: ITable;
  
  /**
   * Environment variables for the initializer Lambda
   */
  environment: { [key: string]: string };
  
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
 * Custom resource to initialize DynamoDB table from tenants-config.json
 * 
 * This construct:
 * 1. Checks if the DynamoDB table exists and has data
 * 2. If table is empty, performs ONE-TIME ASM registration for all tenants
 * 3. Imports tenant data from tenants-config.json to DynamoDB
 * 
 * The initialization only runs on first deployment. Subsequent deployments
 * will skip initialization if the table already has data.
 */
export class TableInitializer extends Construct {
  public readonly customResource: CustomResource;

  constructor(scope: Construct, id: string, props: TableInitializerProps) {
    super(scope, id);

    // Create the Lambda function for table initialization
    const initializerLambda = new Function(this, 'InitializerFunction', {
      runtime: Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: Code.fromAsset(path.join(__dirname, '../lambda/table-initializer')),
      timeout: Duration.minutes(15), // ASM registration can take time
      memorySize: 512,
      environment: {
        ...props.environment,
        AWS_REGION: props.region,
        AWS_ACCOUNT: props.account,
        AMFATENANT_TABLE: props.table.tableName,
      },
      description: 'Initializes DynamoDB table from tenants-config.json on first deployment',
    });

    // Grant permissions to the Lambda
    
    // DynamoDB permissions
    props.table.grantReadWriteData(initializerLambda);
    
    // Additional DynamoDB permissions for DescribeTable
    initializerLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:DescribeTable'],
        resources: [props.table.tableArn],
      })
    );

    // Secrets Manager permissions
    initializerLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'secretsmanager:CreateSecret',
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
          'secretsmanager:DescribeSecret',
        ],
        resources: [
          `arn:aws:secretsmanager:${props.region}:${props.account}:secret:apersona/*`,
        ],
      })
    );

    // Create the custom resource provider
    const provider = new Provider(this, 'InitializerProvider', {
      onEventHandler: initializerLambda,
    });

    // Create the custom resource
    // This will be triggered during stack creation and updates
    this.customResource = new CustomResource(this, 'InitializerResource', {
      serviceToken: provider.serviceToken,
      properties: {
        TableName: props.table.tableName,
        // Add timestamp to force update on each deployment if needed
        Timestamp: Date.now(),
      },
    });

    // Ensure the custom resource depends on the table being created
    this.customResource.node.addDependency(props.table);
  }
}
