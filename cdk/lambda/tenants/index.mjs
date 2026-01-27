import { putResData } from './put.mjs';
import { deleteResData } from './delete.mjs';
import { getResData } from './get.mjs';

//AWS configurations
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {

	console.info("EVENT\n" + JSON.stringify(event, null, 2))
	console.log('event.requestContext.http.method: ', event.requestContext.http.method);

	const headers = {
		'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key,X-Requested-With',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
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
		switch (event.requestContext.http.method) {
			case 'GET':
				const getResult = await getResData(event, dynamodb);
				return response(200, JSON.stringify({ data: getResult }));
			case 'PUT':
				const payload = JSON.parse(event.body);
				const putResult = await putResData(event, payload.data, payload.previousData, dynamodb);
				return response(200, JSON.stringify({ data: putResult }));
			case 'DELETE':
				const deleteResult = await deleteResData(event, dynamodb);
				return response(200, JSON.stringify({ data: deleteResult }));
			case 'OPTIONS':
				return response(200, JSON.stringify({ data: 'ok' }));
			default:
				return response(404, JSON.stringify({ data: 'Not Found' }));
		}
	}
	catch (e) {
		console.log('Catch an error: ', e);
		const statusCode = e.statusCode || 500;
		const message = e.message || 'Service Error';
		return {
			statusCode,
			headers,
			body: JSON.stringify({ type: 'exception', message }),
		};
	}
}
