import {
	ListIdentityProvidersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

export const getIdPNames = async (cognitoISP) => {
	const data = await cognitoISP.send(new ListIdentityProvidersCommand({
		UserPoolId: process.env.USERPOOL_ID,
	}));

	return data.Providers.map(item => item.ProviderName);
}

export default getIdPNames;