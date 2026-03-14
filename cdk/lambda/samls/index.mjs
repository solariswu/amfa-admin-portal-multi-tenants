import { putResData } from './put.mjs';
import { deleteResData } from './delete.mjs';
import { getResData } from './get.mjs';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { validateTenantAccess, getTenantIdFromRequest, createResponse } from 'admin-auth';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

const samlurl = process.env.SAMLPROXY_API_URL;
const samlReloadUrl = process.env.SAMLPROXY_RELOAD_URL;

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

	const cognitoToken = event.headers.authorization;

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

		const spInfoTable = `amfa-spinfo-${tenantId}`;
		console.log(`Tenant ${tenantId}, spInfoTable: ${spInfoTable}`);

		switch (event.requestContext.http.method) {
			case 'GET':
				const getResult = await getResData(event.pathParameters?.id, samlurl, dynamodb, cognitoToken, spInfoTable);
				return response(200, JSON.stringify({ data: getResult }));
			case 'PUT':
				const payload = JSON.parse(event.body);
				const putResult = await putResData(payload.data, dynamodb, spInfoTable);
				return response(200, JSON.stringify({ data: putResult }));
			case 'DELETE':
				const deleteResult = await deleteResData(event.pathParameters?.id, samlurl, cognitoToken, samlReloadUrl, dynamodb, spInfoTable);
				return response(200, JSON.stringify({ data: deleteResult }));
			case 'OPTIONS':
				return response(200, JSON.stringify({ data: 'ok' }));
			default:
				return response(404, JSON.stringify({ data: 'Not Found' }));
		}
	}
	catch (e) {
		console.log('Catch an error: ', e)
	}

	return {
		statusCode: 500,
		headers,
		body: JSON.stringify({ type: 'exception', message: 'Service Error' }),
	};
}