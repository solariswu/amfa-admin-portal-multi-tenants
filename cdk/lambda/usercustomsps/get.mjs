
//AWS configurations
import { AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";


export const getResData = async (id, cognitoISP, userPoolId) => {

    const params = {
        Username: id,
        UserPoolId: userPoolId || process.env.USERPOOL_ID,
    };

	console.info('params', params);


    const data = await cognitoISP.send(new AdminGetUserCommand(params));
    const item = data.UserAttributes;

	let userCustomSps = [];

	item.forEach(el => {
		if (el.Name === 'website') {
			userCustomSps = JSON.parse (el.Value)
		}
	});


    return {
        id,
        userCustomSps,
    };

};

export default getResData;