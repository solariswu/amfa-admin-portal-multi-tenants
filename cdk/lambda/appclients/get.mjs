
//AWS configurations
import { DescribeUserPoolClientCommand, DescribeUserPoolCommand } from "@aws-sdk/client-cognito-identity-provider";
import { GetItemCommand } from '@aws-sdk/client-dynamodb';


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
        spInfo.serviceProviders = spArray;
    }

    return spInfo;
}


export const getResData = async (ClientId, cognitoISP, dynamodb, userPoolId, spInfoTable) => {

    const params = {
        ClientId,
        UserPoolId: userPoolId,
    };

    const data = await cognitoISP.send(new DescribeUserPoolClientCommand(params));
    const item = data.UserPoolClient;

    const issuer = `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${item.UserPoolId}`;
    const describeUserpoolRes = await cognitoISP.send(new DescribeUserPoolCommand({ UserPoolId: item.UserPoolId }));
    const hostedUIBaseUrl = `https://${describeUserpoolRes.UserPool.Domain}.auth.${process.env.AWS_REGION}.amazoncognito.com`;

    console.log('appclient get result:', item)

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

    const extraInfo = await getSPInfo(dynamodb, ClientId, spInfoTable);

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
        callbackURLs: item.CallbackURLs ? item.CallbackURLs.map(url => ({ url })) : [],
        defaultRedirectURI: item.DefaultRedirectURI,
        logoutURLs: item.LogoutURLs ? item.LogoutURLs.map(url => ({ url })) : [],
        creationDate: item.CreationDate,
        lastModifiedDate: item.LastModifiedDate,
        refreshTokenValidityDays: item.RefreshTokenValidity >= 24 * 60 ? (item.RefreshTokenValidity - item.RefreshTokenValidity % (24 * 60)) / (24 * 60) : 0,
        refreshTokenValidityMins: item.RefreshTokenValidity >= 24 * 60 ? item.RefreshTokenValidity % (24 * 60) : item.RefreshTokenValidity,
        idTokenValidityDays: item.IdTokenValidity >= 24 * 60 ? 1 : 0,
        idTokenValidityMins: item.IdTokenValidity >= 24 * 60 ? 0 : item.IdTokenValidity,
        accessTokenValidityDays: item.AccessTokenValidity >= 24 * 60 ? 1 : 0,
        accessTokenValidityMins: item.AccessTokenValidity >= 24 * 60 ? 0 : item.AccessTokenValidity,
        ...(extraInfo?.serviceProviders && extraInfo?.serviceProviders.length > 0 && {serviceProviders: extraInfo.serviceProviders}),
        ...(extraInfo?.logoUr && extraInfo.logoUrl.length > 0 && {spLogoUrl: extraInfo.logoUrl}),
    };

};

export default getResData;