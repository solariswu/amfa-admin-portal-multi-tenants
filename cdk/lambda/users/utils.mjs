import {
	ListIdentityProvidersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

export const getIdPNames = async (cognitoISP, userPoolId) => {
	const data = await cognitoISP.send(new ListIdentityProvidersCommand({
		UserPoolId: userPoolId,
	}));

	return data.Providers.map(item => item.ProviderName);
}

export default getIdPNames;
