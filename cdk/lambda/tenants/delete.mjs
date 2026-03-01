import {
	QueryCommand,
	DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
	CognitoIdentityProviderClient,
	DeleteGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { validateTenantAccess } from 'admin-auth';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const secretsManager = new SecretsManagerClient({ region: process.env.AWS_REGION });

/**
 * Extract requester email from JWT authorization header
 */
function extractRequesterEmail(event) {
	try {
		const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
		const jwt = authHeader.replace('Bearer ', '');
		const jwtBase64Url = jwt.split('.')[1];
		const jwtBase64 = jwtBase64Url.replace(/-/g, '+').replace(/_/g, '/');
		const jwtBuffer = Buffer.from(jwtBase64, 'base64');
		const jwtPayload = JSON.parse(jwtBuffer.toString('ascii'));
		return jwtPayload.email || 'unknown';
	} catch (error) {
		console.warn('Failed to extract requester email from JWT:', error.message);
		return 'unknown';
	}
}

/**
 * Delete ASM client for this tenant via ASM portal
 * Reads tenant and org credentials from Secrets Manager, then calls deleteAsmClient.ap
 */
async function deleteAsmClient(tenantId, requesterEmail, orgId) {
	const asmPortalUrl = process.env.ASM_PORTAL_URL;
	if (!asmPortalUrl) {
		console.warn('[ASM] ASM_PORTAL_URL not configured, skipping ASM client deletion');
		return;
	}

	// Step 1: Read tenant ASM credentials
	const tenantSecretName = `apersona/asm/tenant/${tenantId}`;
	console.log(`[ASM] Reading tenant credentials from ${tenantSecretName}...`);

	let tenantCredentials;
	try {
		const secretResult = await secretsManager.send(
			new GetSecretValueCommand({ SecretId: tenantSecretName }),
		);
		tenantCredentials = JSON.parse(secretResult.SecretString);
	} catch (secretError) {
		console.error(`[ASM] Failed to read tenant credentials (${tenantSecretName}):`, secretError.message);
		throw new Error(`Cannot delete ASM client: tenant credentials not found`);
	}

	const asmClientId = tenantCredentials.asmClientId;
	const asmClientSecretKey = tenantCredentials.asmClientSecretKey || '';
	const resolvedOrgId = tenantCredentials.orgId || orgId;

	if (!asmClientId) {
		console.warn('[ASM] No asmClientId found for tenant, skipping ASM deletion');
		return;
	}

	// Step 2: Read org ASM credentials to get asmSecretKey
	const orgSecretName = `apersona/asm/org/${resolvedOrgId}`;
	console.log(`[ASM] Reading org credentials from ${orgSecretName}...`);

	let orgCredentials;
	try {
		const secretResult = await secretsManager.send(
			new GetSecretValueCommand({ SecretId: orgSecretName }),
		);
		orgCredentials = JSON.parse(secretResult.SecretString);
	} catch (secretError) {
		console.error(`[ASM] Failed to read org credentials (${orgSecretName}):`, secretError.message);
		throw new Error(`Cannot delete ASM client: org credentials not found`);
	}

	const asmSecretKey = orgCredentials.asmSecretKey;
	if (!asmSecretKey) {
		console.warn('[ASM] No asmSecretKey found for org, skipping ASM deletion');
		return;
	}

	// Step 3: Call deleteAsmClient.ap
	console.log(`[ASM] Deleting ASM client...`);
	console.log(`[ASM]   URL: ${asmPortalUrl}/deleteAsmClient.ap`);
	console.log(`[ASM]   asmClientId: ${asmClientId}`);
	console.log(`[ASM]   requestedBy: ${requesterEmail}`);

	const formData = new URLSearchParams({
		asmClientId: asmClientId,
		requestedBy: requesterEmail,
		asmSecretKey: asmSecretKey,
		asmClientSecretKey: asmClientSecretKey,
	});

	const response = await fetch(`${asmPortalUrl}/deleteAsmClient.ap`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: formData.toString(),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`ASM deleteAsmClient failed (${response.status}): ${errorText}`);
	}

	const result = await response.json();
	console.log(`[ASM] ✓ ASM client deleted:`, JSON.stringify(result));

	return result;
}

export const deleteResData = async (event, dynamodb) => {
	const tenantId = event.pathParameters?.id;

	// Validate access using lambda layer
	const authResult = await validateTenantAccess(event, tenantId);
	
	if (!authResult.authorized) {
		const error = new Error(authResult.error || 'Access Denied');
		error.statusCode = authResult.statusCode || 403;
		throw error;
	}

	// First, query to get the tenant and its sk
	const queryParams = {
		TableName: `amfa-tenanttable`,
		KeyConditionExpression: 'id = :id AND begins_with(sk, :sk_prefix)',
		ExpressionAttributeValues: {
			':id': { S: `TENANT#${tenantId}` },
			':sk_prefix': { S: 'TENANT#' }
		}
	};

	const queryResult = await dynamodb.send(new QueryCommand(queryParams));
	
	if (!queryResult.Items || queryResult.Items.length === 0) {
		const error = new Error(`Tenant ${tenantId} not found`);
		error.statusCode = 404;
		throw error;
	}

	const currentItem = queryResult.Items[0];
	const sk = currentItem.sk.S;
	const orgId = currentItem.org_id?.S || '';

	// Delete ASM client before removing from DynamoDB
	const requesterEmail = extractRequesterEmail(event);
	try {
		await deleteAsmClient(tenantId, requesterEmail, orgId);
	} catch (asmError) {
		console.error(`[ASM] ✗ Failed to delete ASM client (non-fatal):`, asmError.message);
		// Non-fatal: proceed with tenant deletion
	}

	// Delete using composite key
	const params = {
		Key: {
			id: { S: `TENANT#${tenantId}` },
			sk: { S: sk }
		},
		TableName: `amfa-tenanttable`,
	};

	const item = await dynamodb.send(new DeleteItemCommand(params));

	// Delete TA_<tenantId> group from admin userpool
	const adminUserPoolId = process.env.ADMIN_USERPOOL_ID;
	if (adminUserPoolId) {
		const groupName = `TA_${tenantId}`;
		try {
			await cognito.send(
				new DeleteGroupCommand({
					GroupName: groupName,
					UserPoolId: adminUserPoolId,
				}),
			);
			console.log(`[Cognito] ✓ Deleted group '${groupName}' from admin userpool ${adminUserPoolId}`);
		} catch (groupError) {
			if (groupError.name === 'ResourceNotFoundException') {
				console.log(`[Cognito] Group '${groupName}' not found in admin userpool, skipping`);
			} else {
				console.error(`[Cognito] ✗ Failed to delete group '${groupName}':`, groupError.message);
				// Non-fatal: tenant was deleted successfully
			}
		}
	} else {
		console.warn('[Cognito] ADMIN_USERPOOL_ID not configured, skipping TA group deletion');
	}

	return {};
};

export default deleteResData;
