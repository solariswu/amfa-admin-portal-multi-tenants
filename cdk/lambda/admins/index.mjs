import { putResData } from './put.mjs';
import { deleteResData } from './delete.mjs';
import { getResData } from './get.mjs';

import {
	CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

//AWS configurations
const cognitoISP = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

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


export const handler = async (event) => {

	console.info("EVENT\n" + JSON.stringify(event, null, 2))

	console.log('event.requestContext.http.method: ', event.requestContext.http.method);
	try {
		switch (event.requestContext.http.method) {
			case 'GET':
				const getResult = await getResData(event.pathParameters?.id, cognitoISP);
				return response(200, JSON.stringify({ data: getResult }));
			case 'PUT':
				const user = JSON.parse(event.body);
				const putResult = await putResData(user.data, cognitoISP);
				return response(200, JSON.stringify({ data: putResult }));
			case 'DELETE':
				const deleteResult = await deleteResData(event.pathParameters, cognitoISP, event.requestContext.authorizer.jwt.claims.email);
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
};
