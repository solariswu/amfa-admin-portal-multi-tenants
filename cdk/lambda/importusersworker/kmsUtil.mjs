import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({
	region: process.env.AWS_REGION,
});

export const getSMTP = async (tenantId) => {
	if (!tenantId) {
		throw new Error("tenantId is required to fetch SMTP credentials");
	}
	const response = await client.send(
		new GetSecretValueCommand({
			SecretId: `apersona/${tenantId}/smtp`,
		})
	);
	const secret = JSON.parse(response.SecretString);

	return secret;
}