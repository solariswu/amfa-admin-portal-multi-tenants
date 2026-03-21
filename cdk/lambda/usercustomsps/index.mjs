
import { putResData } from './put.mjs';
import { getResData } from './get.mjs';

//AWS configurations
import {
    CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

const cognitoISP = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

export const handler = async (event) => {

    console.info("EVENT\n" + JSON.stringify(event, null, 2))
    console.log('event.requestContext.http.method: ', event.requestContext.http.method);

    const headers = {
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key,X-Requested-With',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS,GET,PUT',
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

    let errMsg = { type: 'exception', message: 'Service Error' };

    // Get UserPoolId from authorizer context (multi-tenant) or env var (legacy)
    const authContext = event.requestContext?.authorizer?.lambda || event.requestContext?.authorizer || {};
    const userPoolId = authContext.userPoolId || process.env.USERPOOL_ID;

    try {
        switch (event.requestContext.http.method) {
            case 'GET':
                const getResult = await getResData(event.pathParameters?.id, cognitoISP, userPoolId);
                return response(200, JSON.stringify({ data: getResult }));
            case 'PUT':
                const payload = JSON.parse(event.body);
                const putResult = await putResData(event.pathParameters?.id, payload, cognitoISP, userPoolId);
                return response(200, JSON.stringify(putResult));
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


