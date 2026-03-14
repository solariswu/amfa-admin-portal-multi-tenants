import {
    UpdateUserPoolClientCommand,
    DescribeUserPoolClientCommand,
    DescribeUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";

import { PutItemCommand } from "@aws-sdk/client-dynamodb";

const storeSPInfo = async (clientId, serviceProviders, serviceLogoUrl, dynamodbISP, spInfoTable) => {

    const params = {
        Item: {
            id: {
                S: '#OIDC#' + clientId,
            },
            name: {
                S: '',
            },
            logoUrl: {
                S: serviceLogoUrl ? serviceLogoUrl : '',
            },
            serviceUrl: {
                S: JSON.stringify(serviceProviders),
            },
        },
        ReturnConsumedCapacity: 'TOTAL',
        TableName: spInfoTable,
    };

    console.log('storeSPInfo Input:', params);

    const data = await dynamodbISP.send(new PutItemCommand(params));

    console.log('put oidc sp storeSPInfo Output:', data);

    return serviceProviders;
}

export const putResData = async (data, cognitoISP, dynamodb, userPoolId, spInfoTable) => {
    console.log('putResData Input:', data);

    const {
        id, clientName, serviceLogoUrl,
        refreshTokenValidityDays, refreshTokenValidityMins,
        accessTokenValidityDays, accessTokenValidityMins,
        idTokenValidityDays, idTokenValidityMins,
        serviceProviders
    } = data;

    let params = {
        ClientId: id,
        UserPoolId: userPoolId,
    };

    const describeRes = await cognitoISP.send(new DescribeUserPoolClientCommand(params));
    let item = describeRes.UserPoolClient;

    item.CallbackURLs = [];
    item.ClientName = clientName;
    item.SupportedIdentityProviders = ['apersona'];
    item.LogoutURLs = [];
    serviceProviders.forEach(sp => {
        if (sp.splogoutcallback) {
            item.LogoutURLs.push(sp.splogoutcallback);
        }
        if (sp.spcallback) {
            item.CallbackURLs.push(sp.spcallback);
        }
    })
    item.DefaultRedirectURI = item.CallbackURLs[0];

    if (refreshTokenValidityDays || refreshTokenValidityMins) {
        item.RefreshTokenValidity = parseInt(refreshTokenValidityDays) * 24 * 60 + parseInt(refreshTokenValidityMins);
        item.TokenValidityUnits.RefreshToken = 'minutes';
    }
    if (accessTokenValidityDays || accessTokenValidityMins) {
        item.AccessTokenValidity = parseInt(accessTokenValidityDays) * 24 * 60 + parseInt(accessTokenValidityMins);
        item.TokenValidityUnits.AccessToken = 'minutes';
    }
    if (idTokenValidityDays || idTokenValidityMins) {
        item.IdTokenValidity = parseInt(idTokenValidityDays) * 24 * 60 + parseInt(idTokenValidityMins);
        item.TokenValidityUnits.IdToken = 'minutes';
    }

    delete item.ClientSecret;

    params = {
        UserPoolId: userPoolId,
        ...item,
    }

    const resData = await cognitoISP.send(new UpdateUserPoolClientCommand(params));
    item = resData.UserPoolClient;

    if (item) {
        const issuer = `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${item.UserPoolId}`;
        const describeUserpoolRes = await cognitoISP.send(new DescribeUserPoolCommand({ UserPoolId: item.UserPoolId }));
        const hostedUIBaseUrl = `https://${describeUserpoolRes.UserPool.Domain}.auth.${process.env.AWS_REGION}.amazoncognito.com`;

        if (item.TokenValidityUnits.RefreshToken && item.TokenValidityUnits.RefreshToken !== 'minutes') {
            switch (item.TokenValidityUnits.RefreshToken) {
                case 'hours':
                    item.RefreshTokenValidity *= 60;
                    break;
                case 'days':
                    item.RefreshTokenValidity *= 24 * 60;
                    break;
                default:
                    break;
            }
        }
        else if (!item.TokenValidityUnits.RefreshToken) {
            item.RefreshTokenValidity *= 24 * 60;
        }

        if (!item.AccessTokenValidity) {
            item.AccessTokenValidity = 60;
        }

        if (item.TokenValidityUnits.AccessToken && item.TokenValidityUnits.AccessToken !== 'minutes') {
            switch (item.TokenValidityUnits.AccessToken) {
                case 'hours':
                    item.AccessTokenValidity *= 60;
                    break;
                case 'days':
                    item.AccessTokenValidity *= 24 * 60;
                    break;
                default:
                    break;
            }
        }

        if (!item.IdTokenValidity) {
            item.IdTokenValidity = 60;
        }

        if (item.TokenValidityUnits.IdToken && item.TokenValidityUnits.IdToken !== 'minutes') {
            switch (item.TokenValidityUnits.IdToken) {
                case 'hours':
                    item.IdTokenValidity *= 60;
                    break;
                case 'days':
                    item.IdTokenValidity *= 24 * 60;
                    break;
                default:
                    break;
            }
        }

        await storeSPInfo(item.ClientId, serviceProviders, serviceLogoUrl, dynamodb, spInfoTable);

        return {
            id: item.ClientId,
            clientName: item.ClientName,
            clientSecret: item.ClientSecret,
            userPoolId: item.UserPoolId,
            issuer,
            OIDCMetadataUrl: `${issuer}/.well-known/openid-configuration`,
            jwksUri: `${issuer}/.well-known/jwks.json`,
            authorizationEndpoint: `${hostedUIBaseUrl}/oauth2/authorize`,
            tokenEndpoint: `${hostedUIBaseUrl}/oauth2/token`,
            userInfoEndpoint: `${hostedUIBaseUrl}/oauth2/userinfo`,
            revokeEndpoint: `${hostedUIBaseUrl}/oauth2/revoke`,
            endSessionEndpoint: `${hostedUIBaseUrl}/logout`,
            supportedScopes: item.AllowedOAuthScopes?.toString().replaceAll(',', ' '),
            // callbackURLs: item.CallbackURLs ? item.CallbackURLs.map(url => ({ url })) : [],
            defaultRedirectURI: item.DefaultRedirectURI,
            // logoutURLs: item.LogoutURLs ? item.LogoutURLs.map(url => ({ url })) : [],
            creationDate: item.CreationDate,
            lastModifiedDate: item.LastModifiedDate,
            refreshTokenValidityDays: item.RefreshTokenValidity >= 24 * 60 ? (item.RefreshTokenValidity - item.RefreshTokenValidity % (24 * 60)) / (24 * 60) : 0,
            refreshTokenValidityMins: item.RefreshTokenValidity >= 24 * 60 ? item.RefreshTokenValidity % (24 * 60) : item.RefreshTokenValidity,
            idTokenValidityDays: item.IdTokenValidity >= 24 * 60 ? 1 : 0,
            idTokenValidityMins: item.IdTokenValidity >= 24 * 60 ? 0 : item.IdTokenValidity,
            accessTokenValidityDays: item.AccessTokenValidity >= 24 * 60 ? 1 : 0,
            accessTokenValidityMins: item.AccessTokenValidity >= 24 * 60 ? 0 : item.AccessTokenValidity,
            serviceProviders,
            serviceLogoUrl,
        }
    }

    return null;
}

export default putResData;