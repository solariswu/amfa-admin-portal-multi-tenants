import {
	QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { validateTenantAccess } from 'admin-auth';

const postURL = `https://api.${process.env.AMFA_BASE_URL}/amfa`;

const fetchAmfaSecrets = async (id) => fetch(postURL, {
	method: "POST",
	headers: {
		'Content-Type': 'application/json',
		'Accept': 'application/json',
		'Origin': `https://${id}.${process.env.AMFA_BASE_URL}`,
	},
	body: JSON.stringify({
		phase: 'admingetsecretinfo', tenantid: id
	}),
});

export const getResData = async (event, dynamodb) => {
	const tenantId = event.pathParameters?.id;

	// Validate access using lambda layer
	const authResult = await validateTenantAccess(event, tenantId);
	
	if (!authResult.authorized) {
		const error = new Error(authResult.error || 'Access Denied');
		error.statusCode = authResult.statusCode || 403;
		throw error;
	}

	//fetch tenant Info - use Query with composite key
	const params = {
		TableName: `amfa-tenanttable`,
		KeyConditionExpression: 'id = :id AND begins_with(sk, :sk_prefix)',
		ExpressionAttributeValues: {
			':id': { S: `TENANT#${tenantId}` },
			':sk_prefix': { S: 'TENANT#' }
		}
	};

	const result = await dynamodb.send(new QueryCommand(params));

	console.log('get tenants result', result);

	const item = result.Items && result.Items.length > 0 ? result.Items[0] : null;


	const res = await fetchAmfaSecrets(tenantId);
	const resJson = await res.json();

	console.log('get secret json from amfa', resJson);
	const smtp = resJson.message;
	smtp.secure = smtp.secure === "true" || smtp.secure === true ? true : false;

	if (item && item.name) {

		return {
			id: tenantId,
			name: decodeURIComponent(item.name.S),
			contact: item.contact.S,
			url: item.url.S,
			endUserSpUrl: item.endUserSpUrl.S,
			samlproxy: item.samlproxy?.BOOL,
			samlIdPMetadataUrl: process.env.SAMLPROXY_METADATA_URL,
			adminApiUrl: `https://api.adminportal.${process.env.ROOT_DOMAIN_NAME}`,
			endUserSpRegion: process.env.AWS_REGION,
			endUserSpWebClientId: process.env.SP_PORTAL_CLIENT_ID,
			endUserSpUserpoolId: process.env.USER_POOL_ID,
			endUserSpOauthDomain: smtp.oauthdomain,
			org_id: item.org_id?.S || 'default', // Include org_id in response
			...smtp,
			// branding: item.branding,
		};
	}

	throw new Error('Not Found!');
};

export default getResData;
