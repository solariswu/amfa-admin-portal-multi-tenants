//AWS configurations
import {
    DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';


export const deleteResData = async (endcodedId, samlurl, cognitoToken, reloadUrl, dynamodb, spInfoTable) => {

    if (endcodedId) {

        // const clientId = await getUserPoolClientId(cognitoISP);
        const entityId = atob(endcodedId);

        // if (clientId) {
        const response = await fetch(`${samlurl}/${endcodedId}`, {
            method: "DELETE", // *GET, POST, PUT, DELETE, etc.
            cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
            headers: {
                "Content-Type": "application/json",
                "Authorization": cognitoToken,
            },
            body: JSON.stringify({
                clientId: process.env.SAML_CLIENTID,
                entityId,
            }), // body data type must match "Content-Type" header
        });

        console.log('saml sp delete result', response);

        const res = await fetch(reloadUrl, {
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

        try {
            await dynamodb.send(new DeleteItemCommand({
                TableName: spInfoTable,
                Key: {
                    id: { S: '#SAML#' + endcodedId },
                },
            }));
        } catch (err) {
            console.log('Error deleting SAML SPINFO item from dynamodb', err);
        }

        return response.json();

    };
}

export default deleteResData;