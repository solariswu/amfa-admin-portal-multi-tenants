import { putResData } from './put.mjs';
import { deleteResData } from './delete.mjs';
import { getResData } from './get.mjs';

//AWS configurations
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { validateTenantAccess, getTenantIdFromRequest, createResponse } from 'admin-auth';

const dynamodbISP = new DynamoDBClient({ region: process.env.AWS_REGION });
const cognitoISP = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {

	console.info("EVENT\n" + JSON.stringify(event, null, 2))
	console.log('event.requestContext.http.method: ', event.requestContext.http.method);

	const headers = {
		'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key,X-Tenant-Id,X-Requested-With',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT,DELETE',
	};

	const response = (statusCode = 200, body) => {
		console.log('return with:', { statusCode, headers, body });
		return { statusCode, headers, body };
	};

	let errMsg = { type: 'exception', message: 'Service Error' };

	try {
		// Multi-tenant: resolve tenant from X-Tenant-Id header
		const tenantId = getTenantIdFromRequest(event);
		if (!tenantId) {
			return createResponse(400, { error: 'tenant_id required in request' });
		}

		const authResult = await validateTenantAccess(event, tenantId);
		if (!authResult.authorized) {
			return createResponse(authResult.statusCode, { error: authResult.error });
		}

		const { userPoolId } = authResult;
		const spInfoTable = `amfa-spinfo-${tenantId}`;
		console.log(`Tenant ${tenantId}, userPoolId: ${userPoolId}, spInfoTable: ${spInfoTable}`);

		switch (event.requestContext.http.method) {
			case 'GET':
				const getResult = await getResData(event.pathParameters?.id, cognitoISP, dynamodbISP, userPoolId, spInfoTable);
				return response(200, JSON.stringify({ data: getResult }));
			case 'PUT':
				const payload = JSON.parse(event.body);
				const putResult = await putResData(payload.data, cognitoISP, dynamodbISP, userPoolId, spInfoTable);
				return response(200, JSON.stringify({ data: putResult }));
			case 'DELETE':
				const deleteResult = await deleteResData(event.pathParameters?.id, cognitoISP, dynamodbISP, userPoolId, spInfoTable);
				return response(200, JSON.stringify({ data: deleteResult }));
			case 'OPTIONS':
				return response(200, JSON.stringify({ data: 'ok' }));
			default:
				return response(404, JSON.stringify({ data: 'Not Found' }));
		}
	}
	catch (e) {
		console.log('Catch an error: ', e)
		switch (e?.name) {
			case 'ThrottlingException':
				errMsg = { type: 'exception', message: 'Too many requests' };
				break;
			case 'InvalidParameterValue':
			case 'InvalidParameterException':
				errMsg = { type: 'exception', message: 'Invalid parameter' };
				break;
			default:
				errMsg = { type: 'exception', message: 'Service Error' };
				break;
		}
	}

	return {
		statusCode: 500,
		headers,
		body: JSON.stringify(errMsg),
	};
}