//AWS configurations
import {
    ListUserPoolClientsCommand,
    CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const dynamodbISP = new DynamoDBClient({ region: process.env.AWS_REGION });
const cognitoISP = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

const samlurl = process.env.SAMLPROXY_API_URL;
const Limit = 60;

const getSAMLSpInfo = async (dynamodb, cognitoToken, spInfoTable) => {
    let data = []

    try {
        const res = await fetch(samlurl, {
            method: "GET",
            cache: "no-cache",
            headers: {
                "Content-Type": "application/json",
                "Authorization": cognitoToken,
            }
        });
        console.log('fetch samlurl res', res)

        const resData = await res.json();
        console.log('fetch samlurl resData', resData)

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
                        released: spInfoRes?.Item?.released?.BOOL ? true : false,
                    }
                }
            }
            catch (e) {
                console.log('samlslist get spInfo from dynamodb error', e)
            }

            data.push({
                id: resData[item].id,
                name: resData[item].name,
                entityId: resData[item].entityId,
                logoUrl: spInfo?.logoUrl,
                serviceUrl: spInfo?.serviceUrl,
                released: spInfo?.released,
            })
        }
    } catch (error) {
        console.error ('samlslist fetch samlurl error', error)
    }

    return data;
}

const getSPInfo = async (dynamodb, clientId, spInfoTable) => {

    const params = {
        TableName: spInfoTable,
        Key: {
            id: { S: `#OIDC#${clientId}` },
        },
    };

    let spInfo = null;
    let spArray = [];

    try {
        const spInfoRes = await dynamodb.send(new GetItemCommand(params));

        console.log('get spInfo from dynamodb Res', spInfoRes)

        if (spInfoRes?.Item?.id) {
            spInfo = {
                logoUrl: spInfoRes?.Item?.logoUrl?.S,
                serviceUrl: spInfoRes?.Item?.serviceUrl?.S,
                released: spInfoRes?.Item?.released?.BOOL,
            }
        }
    }
    catch (e) {
        console.log('appclient get spInfo from dynamodb error', e)
    }

    if (spInfo?.serviceUrl) {
        try {
            spArray = JSON.parse(spInfo.serviceUrl)
        }
        catch (e) {
            console.log('appclient oidc spInfo serviceUrl json parse error', e)
        }
        delete spInfo.serviceUrl;
        spInfo.serviceProviders = spArray.filter(el => el.released);
    }

    return spInfo;
}

export const handler = async (event) => {

    console.info("EVENT\n" + JSON.stringify(event, null, 2))

    let errMsg = { type: 'exception', message: 'Service Error' };
    const cognitoToken = event.headers.authorization;

    try {

        // Get UserPoolId and tenantId from authorizer context (multi-tenant)
        const authContext = event.requestContext?.authorizer?.lambda || event.requestContext?.authorizer || {};
        const userPoolId = authContext.userPoolId || process.env.USERPOOL_ID;
        const tenantId = authContext.tenantId;

        // Per-tenant spinfo table: amfa-spinfo-{tenantId}
        const spInfoTable = tenantId ? `amfa-spinfo-${tenantId}` : process.env.AMFA_SPINFO_TABLE;

        const params = {
            Limit,
            ...(event.body && { NextToken: event.body }), // tokens[1] contain the token query for page 1.
            UserPoolId: userPoolId,
        }

        console.info('params', params);

        let data = await cognitoISP.send(new ListUserPoolClientsCommand(params));

        let resData = [];
        if (data?.UserPoolClients && data.UserPoolClients.length > 0) {
            const res = data.UserPoolClients.filter(
                appclient =>
                    appclient.ClientName !== 'hostedUIClient' &&
                    appclient.ClientName !== 'customAuthClient' &&
                    !appclient.ClientName.startsWith('amfasys_'));
            for (const item of res) {
                const spInfo = await getSPInfo(dynamodbISP, item.ClientId, spInfoTable);
                if (spInfo && spInfo.serviceProviders.length > 0) {
                    resData.push({
                        id: item.ClientId,
                        name: item.ClientName,
                        logoUrl: spInfo.logoUrl,
                        serviceProviders: spInfo.serviceProviders,
                        type: 'oidc',
                    });
                }
            }
        }

        const samlsps = await getSAMLSpInfo(dynamodbISP, cognitoToken, spInfoTable);

        samlsps.forEach(samlsp => {
            // hide non-released sp from end user
            if (samlsp.released) {
                resData.push({
                    id: samlsp.id,
                    name: samlsp.name,
                    logoUrl: samlsp.logoUrl,
                    serviceUrl: samlsp.serviceUrl,
                    released: samlsp.released,
                    type: 'saml',
                })
            }
        })

        // deco the list by replacing root item with children when there is only one child item.
        const finalData = resData.map(el => {
            if (el.serviceProviders?.length === 1) {
                el.id = el.id + '#' + el.serviceProviders[0].spname.replace(/\s/g, '');
                el.name = el.serviceProviders[0].spname;
                el.released = el.serviceProviders[0].released;
                el.logoUrl = el.serviceProviders[0].splogourl?.length ? el.serviceProviders[0].splogourl : el.logoUrl;
                el.serviceUrl = el.serviceProviders[0].sploginurl;
                delete el.serviceProviders;
            }
            return el;
        })

        // getList of React-admin expects response to have header called 'Content-Range'.
        // when we add new header in response, we have to acknowledge it, so 'Access-Control-Expose-Headers'
        const page = parseInt(event.queryStringParameters.page);
        const perPage = parseInt(event.queryStringParameters.perPage);
        const start = (page - 1) * perPage;
        const end = finalData.length + start - 1;

        finalData.sort((a, b) => {
            if (a.id < b.id) return -1;
            if (a.id > b.id) return 1;
            return 0;
        });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key,Content-Range,X-Requested-With',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
                'Access-Control-Expose-Headers': 'Content-Range',
                'Content-Range': `serviceproviders ${start}-${end}`,
            },
            body: JSON.stringify({
                data: finalData,
                total: finalData.length,
            }),
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
    // TODO implement
    const response = {
        statusCode: 500,
        body: JSON.stringify(errMsg),
    };
    return response;
};
