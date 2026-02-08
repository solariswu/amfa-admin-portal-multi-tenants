// import { putResData } from './put.mjs';
import { deleteResData } from './delete.mjs';
import { getResData } from './get.mjs';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {

	console.info("EVENT\n" + JSON.stringify(event, null, 2))
	console.log('event.requestContext.httpMethod: ', event.requestContext.httpMethod);

	const headers = {
		'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key,X-Requested-With',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'OPTIONS,GET,DELETE',
	};

	const response = (statusCode = 200, body) => {
		console.log('return with:', {
			statusCode,
			headers,
			body,
		});
		return {
			statusCode,
			headers,
			body,
		};
	};

	try {
		switch (event.requestContext.httpMethod) {
			case 'GET':
				const getResult = await getResData({
					email: event.pathParameters?.id,
					pid: event.queryStringParameters?.p,
					tid: event.queryStringParameters?.e,
				}, dynamodb, event.queryStringParameters?.t ? event.queryStringParameters.t : 'c');
				return response(200, JSON.stringify({ data: getResult }));
			case 'DELETE':
				const deleteResult = await deleteResData({
					email: event.pathParameters?.id,
					pid: event.queryStringParameters?.p,
					tid: event.queryStringParameters?.e,
				}, dynamodb, cognito);
				return response(200, JSON.stringify({ data: 'OK', deletedRecsCount: deleteResult }));
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


