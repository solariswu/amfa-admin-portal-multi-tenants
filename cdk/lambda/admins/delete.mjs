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

	const mobileToken = user.UserAttributes.find(attr => attr.Name === "custom:totp-label")?.Value;
    const email = user.UserAttributes.find(attr => attr.Name === "email")?.Value;


    const postURL = `https://api.${process.env.AMFA_BASE_URL}/amfa`;

    console.log('admin delete user amfa api body:', JSON.stringify({ email, hasTOTP: (mobileToken && mobileToken.length > 0), admin,  phase: 'admindeleteuser' }));

    const amfaResponse = await fetch(postURL, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Origin': `https://${process.env.AMFA_BASE_URL}`,
        },
        body: JSON.stringify({ email, hasTOTP: (mobileToken && mobileToken.length > 0), admin,  phase: 'admindeleteuser' }),
    });

    console.log('admin delete user amfa api response', amfaResponse);

    return {
        id: data.id,
    }
}

export default deleteResData;