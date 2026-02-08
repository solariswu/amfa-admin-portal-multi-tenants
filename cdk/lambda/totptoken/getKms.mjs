import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { getSecretName, getSMTPSecretName } from "./const.mjs";

const client = new SecretsManagerClient({
	region: process.env.AWS_REGION,
});

export const getSecret = async (tenant_id) => {
	const response = await client.send(
		new GetSecretValueCommand({
			SecretId: getSecretName(tenant_id),
			VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
		})
	);
	const secret = JSON.parse(response.SecretString);

	return secret;
}

export const getAsmSalt = async () => {
	const secret = await getSecret ();
	return secret?.asmSalt;
}

export const getSMTP = async (tenant_id) => {
	const response = await client.send(
		new GetSecretValueCommand({
			SecretId: getSMTPSecretName(tenant_id),
			VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
		})
	);
	const secret = JSON.parse(response.SecretString);
	secret.secure = secret.secure === 'true' || secret.secure === true ? true : false;

	return secret;
}
