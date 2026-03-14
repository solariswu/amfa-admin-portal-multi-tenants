import { GetItemCommand } from '@aws-sdk/client-dynamodb';


export const getResData = async (encodedId, samlurl, dynamodb, cognitoToken, spInfoTable) => {

    if (encodedId) {

        const entityId = atob(encodedId);

        console.log('Getting from ', `${samlurl}/${encodedId}`)

        const id = btoa(entityId + '_' + process.env.SAML_CLIENTID);
        const response = await fetch(`${samlurl}/${id}`, {
            method: "GET",
            cache: "no-cache",
            headers: {
                "Content-Type": "application/json",
                "Authorization": cognitoToken,
            },
        });

        if (response.status !== 200) {
            throw new Error(`Error: ${response.status}`);
        }

        const resData = await response.json();

        console.log('fetch samlproxy get resData', resData)

        const params = {
            TableName: spInfoTable,
            Key: {
                id: { S: `#SAML#${encodedId}` },
            },
        };

        let spInfo = null;

        try {
            const spInfoRes = await dynamodb.send(new GetItemCommand(params));

            console.log('get spInfo from dynamodb Res', spInfoRes)

            if (spInfoRes?.Item?.id) {
                spInfo = {
                    logoUrl: spInfoRes?.Item?.logoUrl?.S,
                    serviceUrl: spInfoRes?.Item?.serviceUrl?.S,
                    released: spInfoRes?.Item?.released?.BOOL ? true: false,
                }
            }
        }
        catch (e) {
            console.log('samlslist get spInfo from dynamodb error', e)
        }

        return {
            id: encodedId,
            name: resData.name,
            metadataUrl: resData.metadataUrl,
            entityId,
            serviceUrl: spInfo?.serviceUrl,
            logoUrl: spInfo?.logoUrl,
            released: spInfo?.released,
        }
    }

    return {
        id: encodedId
    }

};
