import {
	SecretsManagerClient,
	GetSecretValueCommand,
	UpdateSecretCommand
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({
	region: process.env.AWS_REGION,
});

export const setSMTP = async (tenantId, secret) => {
	const response = await client.send(
		new UpdateSecretCommand({
			SecretId: `apersona/${tenantId}/smtp`,
			SecretString: JSON.stringify(secret),
		})
	);
	return response;
}

export const getSMTP = async (tenantId) => {
	const response = await client.send(
		new GetSecretValueCommand({
			SecretId: `apersona/${tenantId}/smtp`,
		})
	);
	const secret = JSON.parse(response.SecretString);

	return secret;
}
