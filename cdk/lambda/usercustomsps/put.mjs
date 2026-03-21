import {
	AdminUpdateUserAttributesCommand,
} from "@aws-sdk/client-cognito-identity-provider";


export const putResData = async (id, userCustomSps, cognitoISP, userPoolId) => {
	console.log('putResData Input id:', id, ' userCustomSps', userCustomSps);

	let params = {
		UserPoolId: userPoolId || process.env.USERPOOL_ID,
		Username: id,
		UserAttributes: [
			{ // AttributeType
				Name: "website", // required
				Value: JSON.stringify(userCustomSps),
			},
		],
	};

	const response = await cognitoISP.send(new AdminUpdateUserAttributesCommand(params));
	console.log('update user', id, 'custom sp list response', response)

	return {
		id,
		userCustomSps,
	}

}

export default putResData;