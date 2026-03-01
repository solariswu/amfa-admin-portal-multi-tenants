import {
	QueryCommand,
	UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { validateTenantAccess } from 'admin-auth';

const samlurl = process.env.SAMLPROXY_API_URL;
const samlReloadUrl = process.env.SAMLPROXY_RELOAD_URL;
const samlCleanUrl = process.env.SAMLPROXY_CLEAN_URL;

const postURL = `https://api.${process.env.AMFA_BASE_URL}/amfa`;

const updateSmtp = async (id, smtp) => fetch(postURL, {
	method: "POST",
	headers: {
		'Content-Type': 'application/json',
		'Accept': 'application/json',
		'Origin': `https://${id}.${process.env.AMFA_BASE_URL}`,
	},
	body: JSON.stringify({
		phase: 'adminupdatesmtp', tenantid: id, smtp
	}),
});

const taggleSaml = async (cognitoToken, enable) => {
	const resClean = await fetch(samlCleanUrl, {
		method: "GET", // *GET, POST, PUT, DELETE, etc.
		cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
		headers: {
			"Content-Type": "application/json",
			"Authorization": cognitoToken,
		},
	});
	const resCleanText = await resClean.text();
	console.log('samlproxy clean result', resClean);
	console.log('samlproxy clean result text', resCleanText);

	const response = await fetch(samlurl, {
		method: "PUT",
		cache: "no-cache",
		headers: {
			"Content-Type": "application/json",
			"Authorization": cognitoToken,
		},
		body: JSON.stringify({
			action: enable ? 'enable' : 'disable',
			clientId: process.env.SAML_CLIENTID,
		}), // body data type must match "Content-Type" header
	});
	console.log('samlslist put result', response);

	const res = await fetch(samlReloadUrl, {
		method: "GET", // *GET, POST, PUT, DELETE, etc.
		cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
		headers: {
			"Content-Type": "application/json",
			"Authorization": cognitoToken,
		},
	});
	const resTxt = await res.text();
	console.log('samlproxy reload result', res);
	console.log('samlproxy reload result text', resTxt);
}

export const putResData = async (event, payload, previousData, dynamodb) => {
	console.log('putResData Input:', payload);

	// Validate access using lambda layer
	const authResult = await validateTenantAccess(event, payload.id);
	
	if (!authResult.authorized) {
		const error = new Error(authResult.error || 'Access Denied');
		error.statusCode = authResult.statusCode || 403;
		throw error;
	}

	// First, query to get the current tenant and its sk
	const queryParams = {
		TableName: `amfa-tenanttable`,
		KeyConditionExpression: 'id = :id AND begins_with(sk, :sk_prefix)',
		ExpressionAttributeValues: {
			':id': { S: `TENANT#${payload.id}` },
			':sk_prefix': { S: 'TENANT#' }
		}
	};

	const queryResult = await dynamodb.send(new QueryCommand(queryParams));
	
	if (!queryResult.Items || queryResult.Items.length === 0) {
		const error = new Error(`Tenant ${payload.id} not found`);
		error.statusCode = 404;
		throw error;
	}

	const currentItem = queryResult.Items[0];
	const sk = currentItem.sk.S;

	// Update the tenant using composite key
	const now = new Date().toISOString();
	const updateParams = {
		TableName: `amfa-tenanttable`,
		Key: {
			id: { S: `TENANT#${payload.id}` },
			sk: { S: sk }
		},
		UpdateExpression: 'SET #name = :name, contact = :contact, #url = :url, endUserSpUrl = :endUserSpUrl, samlproxy = :samlproxy, org_id = :org_id, updated_at = :updated_at',
		ExpressionAttributeNames: {
			'#name': 'name',
			'#url': 'url'
		},
		ExpressionAttributeValues: {
			':name': { S: payload.name },
			':contact': { S: payload.contact },
			':url': { S: payload.url },
			':endUserSpUrl': { S: payload.endUserSpUrl },
			':samlproxy': { BOOL: payload.samlproxy },
			':org_id': { S: payload.org_id || 'default' },
			':updated_at': { S: now }
		},
		ReturnValues: 'ALL_NEW'
	};

	const item = await dynamodb.send(new UpdateItemCommand(updateParams));

	// Get authorization token from event
	const cognitoToken = event.headers?.authorization || event.headers?.Authorization;

	if (payload.samlproxy !== previousData.samlproxy) {
		await taggleSaml(cognitoToken, payload.samlproxy)
	}

	const smtp = { host: previousData.host, port: previousData.port, user: previousData.user, pass: previousData.pass, secure: previousData.secure };
	const smtpChanged = smtp.host !== payload.host || smtp.port !== payload.port || smtp.user !== payload.user || smtp.pass !== payload.pass || smtp.secure !== payload.secure;
	if (smtpChanged) {
		const smtp = {
			host: payload.host,
			port: payload.port,
			user: payload.user,
			pass: payload.pass,
			secure: payload.secure ? 'true' : 'false',
		};
		await updateSmtp(payload.id, smtp);
	}

	return payload
}

export default putResData;
