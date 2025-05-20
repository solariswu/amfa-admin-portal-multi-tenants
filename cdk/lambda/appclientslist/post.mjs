//AWS configurations
import { CreateUserPoolClientCommand, DescribeUserPoolCommand } from "@aws-sdk/client-cognito-identity-provider";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";

const storeSPInfo = async (clientId, serviceProviders, serviceLogoUrl, dynamodbISP) => {

    const params = {
        Item: {
            id: {
                S: '#OIDC#' + clientId,
            },
            name: {
                S: '',
            },
            logoUrl: {
                S: serviceLogoUrl,
            },
            serviceUrl: {
                S: JSON.stringify(serviceProviders),
            },
        },
        ReturnConsumedCapacity: 'TOTAL',
        TableName: process.env.AMFA_SPINFO_TABLE,
    };

    console.log('storeSPInfo Input:', params);

    const data = await dynamodbISP.send(new PutItemCommand(params));

    console.log('put oidc sp storeSPInfo Output:', data);

    return serviceProviders;
}

export const postResData = async (data, cognitoISP, dynamodb) => {
    let CallbackURLs = [];
    let LogoutURLs = [];

    data.serviceProviders.forEach(sp => {
        if (sp.spcallback) {
            CallbackURLs.push(sp.spcallback);
        }
        if (sp.splogoutcallback) {
            LogoutURLs.push(sp.splogoutcallback);
        }
        else {
            delete sp.splogoutcallback
        }
        if (!sp.splogourl) {
            delete sp.splogourl
        }
    })

    const params = {
        ClientName: data.clientName,
        UserPoolId: process.env.USERPOOL_ID,
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthFlows: [
            "code"
        ],
        AllowedOAuthScopes: [
            "openid",
            "email",
            "phone",
            "profile",
        ],
        CallbackURLs,
        ExplicitAuthFlows: [
            "ALLOW_USER_SRP_AUTH",
            "ALLOW_REFRESH_TOKEN_AUTH"
        ],
        GenerateSecret: data.hasClientSecret,
        LogoutURLs,
        SupportedIdentityProviders: ['apersona'],
        EnablePropagateAdditionalUserContextData: data.hasClientSecret,
        AuthSessionValidity: 5,
        WriteAttributes: ['email', 'picture'],
        ReadAttributes: [/*'address',*/ 'email', 'email_verified',
            'phone_number', 'phone_number_verified', 'birthdate',
            'given_name', 'family_name', 'gender', 'middle_name',
            'profile', 'picture', 'website']
    };

    console.log('CreateUserPoolClient params', params)
    const createRes = await cognitoISP.send(new CreateUserPoolClientCommand(params));
    const item = createRes.UserPoolClient;

    const issuer = `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${item.UserPoolId}`;

    const describeUserpoolRes = await cognitoISP.send(new DescribeUserPoolCommand({ UserPoolId: item.UserPoolId }));
    const hostedUIBaseUrl = `https://${describeUserpoolRes.UserPool.Domain}.auth.${process.env.AWS_REGION}.amazoncognito.com`;

    await storeSPInfo(item.ClientId, data.serviceProviders, data.serviceLogoUrl ? data.serviceLogoUrl : '', dynamodb);

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
        defaultRedirectURI: item.DefaultRedirectURI,
        creationDate: item.CreationDate,
        lastModifiedDate: item.LastModifiedDate,
        serviceProviders: data.serviceProviders,
        serviceLogoUrl: data.serviceLogoUrl,
    };

};

export default postResData;