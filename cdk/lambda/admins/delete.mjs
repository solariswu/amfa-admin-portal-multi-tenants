import { AdminDeleteUserCommand, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";

export const deleteResData = async (data, cognitoISP, admin) => {
    console.log('deleteResData Input:', data);

    if (!data || !data.id) {
        return {
            id: 0,
        }
    }

    const user = await cognitoISP.send(new AdminGetUserCommand({
        Username: data.id,
        UserPoolId: process.env.USERPOOL_ID
    }))

    console.log('get user before delete User:', user);

    const result = await cognitoISP.send(new AdminDeleteUserCommand({
        Username: data.id,
        UserPoolId: process.env.USERPOOL_ID,
    }));
    console.log('deleteResData Output:', result);

    return {
        id: data.id,
    }
}

export default deleteResData;