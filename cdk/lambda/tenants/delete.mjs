import {
	DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { validateTenantAccess } from '/opt/nodejs/admin-auth/index.mjs';

export const deleteResData = async (event, dynamodb) => {
	const tenantId = event.pathParameters?.id;

	// Validate access using lambda layer
	const authResult = await validateTenantAccess(event, tenantId);
	
	if (!authResult.authorized) {
		const error = new Error(authResult.error || 'Access Denied');
		error.statusCode = authResult.statusCode || 403;
		throw error;
	}

	const params = {
		Key: {
			id: {
				S: tenantId,
			},
		},
		TableName: `amfa-${this.account}-${this.region}-tenanttable`,
	};

	const item = await dynamodb.send(new DeleteItemCommand(params));

	return {};
};

export default deleteResData;
