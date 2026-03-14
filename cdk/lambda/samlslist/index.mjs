import {
    DynamoDBClient,
    GetItemCommand,
} from '@aws-sdk/client-dynamodb';
import { validateTenantAccess, getTenantIdFromRequest, createResponse } from 'admin-auth';

import postResData from "./post.mjs";

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

const samlurl = process.env.SAMLPROXY_API_URL;

export const handler = async (event) => {

    console.info("EVENT\n" + JSON.stringify(event, null, 2))

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

        const spInfoTable = `amfa-spinfo-${tenantId}`;
        console.log(`Tenant ${tenantId}, spInfoTable: ${spInfoTable}`);

        if (event.requestContext.http.method === 'POST' && (!event.queryStringParameters || !event.queryStringParameters.page)) {
            // create new SAML SP
            const body = JSON.parse(event.body);
            console.log('POST data: ', body);
            const postResult = await postResData(body.data, samlurl, dynamodb, null, event.headers.authorization, spInfoTable);

            console.log('postResult', postResult);

            return {
                statusCode: postResult.statusCode,
                headers: {
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key,X-Tenant-Id,Content-Range,X-Requested-With',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
                    'Access-Control-Expose-Headers': 'Content-Range',
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Credentials': true,
                },
                body: postResult.body,
            };
        }
        else {
            let NextToken = event.body ? event.body : "";

            const res = await fetch(samlurl, {
                method: "GET",
                cache: "no-cache",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": event.headers.authorization,
                },
            });
            console.log('fetch samlurl res', res)

            const resJson = await res.json();
            console.log('fetch samlurl resJson', resJson)
            let resData = []
            for (var i in resJson)
                resData.push(resJson[i])

            let data = []

            if (resData.length > 0 && resData[0].id) {
                for (var item in resData) {

                    console.log('samlslist getting item with id from ddb', resData[item].id)

                    const params = {
                        TableName: spInfoTable,
                        Key: {
                            id: { S: `#SAML#${resData[item].id}` },
                        },
                    };

                    let spInfo = null;

                    try {
                        const spInfoRes = await dynamodb.send(new GetItemCommand(params));

                        console.log('samlslist get spInfo from dynamodb Res', spInfoRes)

                        if (spInfoRes?.Item?.id) {
                            spInfo = {
                                logoUrl: spInfoRes?.Item?.logoUrl?.S,
                                serviceUrl: spInfoRes?.Item?.serviceUrl?.S,
                                released: spInfoRes?.Item?.released?.BOOL ? spInfoRes?.Item?.released?.BOOL : false,
                            }
                        }
                    }
                    catch (e) {
                        console.log('samlslist get spInfo from dynamodb error', e)
                    }

                    data.push({
                        id: resData[item].id,
                        name: resData[item].name,
                        metadataUrl: resData[item].metadataUrl,
                        entityId: resData[item].entityId,
                        released: spInfo?.released,
                        logoUrl: spInfo?.logoUrl,
                        serviceUrl: spInfo?.serviceUrl,
                    })
                }
            }

            const page = parseInt(event.queryStringParameters.page);
            const perPage = parseInt(event.queryStringParameters.perPage);
            const start = (page - 1) * perPage;
            const end = resData.length + start - 1;

            resData.sort((a, b) => {
                if (a.id < b.id) return -1;
                if (a.id > b.id) return 1;
                return 0;
            });

            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key,X-Tenant-Id,Content-Range,X-Requested-With',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
                    'Access-Control-Expose-Headers': 'Content-Range',
                    'Content-Range': `samls ${start}-${end}`,
                },
                body: JSON.stringify({
                    data,
                    total: data.length,
                    ...(NextToken && { PaginationToken: NextToken }),
                }),
            }
        }
    } catch (e) {
        console.log('Catch an error: ', e)
        switch (e.name) {
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
    const response = {
        statusCode: 500,
        body: JSON.stringify(errMsg),
    };
    return response;
};