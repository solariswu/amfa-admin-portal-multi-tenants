import xml2js from 'xml2js';
import { PutItemCommand } from '@aws-sdk/client-dynamodb';

const storeSPInfo = async (payload, dynamodbISP) => {

    const params = {
        Item: {
            id: {
                S: '#SAML#' + payload.id,
            },
            name: {
                S: payload.name,
            },
            logoUrl: {
                S: payload.logoUrl ? payload.logoUrl : '',
            },
            serviceUrl: {
                S: payload.serviceUrl,
            },
            released: {
                BOOL: payload.released ? true : false,
            }
        },
        ReturnConsumedCapacity: 'TOTAL',
        TableName: process.env.AMFA_SPINFO_TABLE,
    };

    console.log('storeSPInfo Input:', params);

    const data = await dynamodbISP.send(new PutItemCommand(params));

    console.log('storeSPInfo Output:', data);

    return data;
}

const getEntityId = async (xmlUrl) => {
    console.log('getEntityId xmlUrl', xmlUrl)
    const get = (data, path) => {
        if (!data) {
            return undefined;
        }

        const splits = path.split(".");

        let value = data;
        for (let i = 0; i < splits.length; i++) {
            value = value[splits[i]];
            if (!value) {
                break;
            }
        }

        return value;
    };

    const mdGet = (data, path) =>
        get(data, path) || get(data, "md:" + path) || get(data, "ns0:" + path);

    const response = await fetch(xmlUrl)
    console.log("response", response);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${xmlUrl}`);
    }

    const textRes = await response.text();

    console.log("textRes", textRes);

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(textRes);

    console.log("result", result);

    const entityDescriptor = mdGet(result, "EntityDescriptor");

    console.log("entityDescriptor", entityDescriptor);

    const entityId = get(entityDescriptor, "$.entityID");

    console.log("entityId", entityId);

    return entityId;
}

const samlReloadUrl = process.env.SAMLPROXY_RELOAD_URL;
const samlCleanUrl = process.env.SAMLPROXY_CLEAN_URL;

export const postResData = async (payload, samlurl, dynamodbISP, cognitoISP, cognitoToken) => {

    console.log('postResData Input:', payload);

    if (payload.metadataUrl) {
        let entityId = null;
        try {
            entityId = await getEntityId(payload.metadataUrl);
        }
        catch (e) {
            return {
                statusCode: 400,
                body: JSON.stringify({ data: e.message, error: e.message }),
            }
        }

        if (entityId) {
            const resClean = await fetch(samlCleanUrl, {
                method: "GET", // *GET, POST, PUT, DELETE, etc.
                cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": cognitoToken,
                },
            });
            const resCleanText = await resClean.text();
            console.log('samlproxy clean result', resClean);
            console.log('samlproxy clean result text', resCleanText);

            const response = await fetch(samlurl, {
                method: "POST", // *GET, POST, PUT, DELETE, etc.
                cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": cognitoToken,
                },
                body: JSON.stringify({
                    ...payload,
                    id: btoa(entityId),
                    issuer: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.USER_POOL_ID}`,
                    clientId: process.env.SAML_CLIENTID,
                    clientSecret: process.env.SAML_CLIENTSECRET,
                    entityId
                }), // body data type must match "Content-Type" header
            });
            console.log('samlslist post result', response);

            if (response.status === 409) {
                return {
                    statusCode: 409,
                    body: JSON.stringify({ data: 'SP already registered on saml proxy server' }),
                }
            }

            if (response.status !== 200) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ data: 'SP creation error' }),
                }
            }

            const res = await fetch(samlReloadUrl, {
                method: "GET", // *GET, POST, PUT, DELETE, etc.
                cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": cognitoToken,
                },
            });
            const resTxt = await res.text();
            console.log('samlproxy reload result', res);
            console.log('samlproxy reload result text', resTxt);

            // store into DynamoDB
            // id, service_sp_type, service_url
            // tenant_id, userpool_id, service_sp_name, entity_id
            await storeSPInfo({
                id: btoa(entityId),
                name: payload.name,
                logoUrl: payload.logoUrl,
                serviceUrl: payload.serviceUrl,
                released: payload.released,
            }, dynamodbISP);

            const data = {
                id: btoa(entityId),
                name: payload.name,
                logoUrl: payload.logoUrl,
                serviceUrl: payload.serviceUrl,
                released: payload.released,
                metadataUrl: payload.metadataUrl,
                entityId,
            }

            return {
                statusCode: response.status,
                body: JSON.stringify({ data }),
            }
        }
        else {
            return {
                statusCode: 400,
                body: JSON.stringify({ data: 'SP creation error' }),
            }
        }

    }

    return {
        statusCode: 400,
        body: JSON.stringify({ data: 'Malformat data' }),
    }
}

export default postResData;