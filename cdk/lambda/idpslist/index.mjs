//AWS configurations
import {
	ListIdentityProvidersCommand,
	CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

import { validateTenantAccess, getTenantIdFromRequest, createResponse } from 'admin-auth';

const cognitoISP = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

const Limit = 60;

export const handler = async (event) => {

	console.info("EVENT\n" + JSON.stringify(event, null, 2))

	// query item's index, indexed from 0.
	const startIdx = (event.queryStringParameters.page - 1) * event.queryStringParameters.perPage;

	//backend page number, indexed from 1
	const page = parseInt(startIdx / Limit) + 1;

	try {
		// Multi-tenant: resolve tenant from X-Tenant-Id header
		const tenantId = getTenantIdFromRequest(event);
		if (!tenantId) {
			return createResponse(400, { error: 'tenant_id required in request' });
		}

		const authResult = await validateTenantAccess(event, tenantId);
		if (!authResult.authorized) {
			return createResponse(authResult.statusCode, { error: authResult.error });
		}

		const { userPoolId } = authResult;
		console.log(`Tenant ${tenantId}, userPoolId: ${userPoolId}`);

		const pagToken = JSON.parse(event.body);
		let NextToken = pagToken?.tokenArray[page];

		const params = {
			Limit,
			NextToken, // tokens[1] contain the token query for page 1.
			UserPoolId: userPoolId,
		}

		//Saving the Pagination token for each page in obj

		console.info('params', params);

		const data = await cognitoISP.send(new ListIdentityProvidersCommand(params));
		// If no remaining groups are there, no paginationToken is returned from cognito
		NextToken = data.NextToken ? data.NextToken : ""
		const resData = data.Groups.map(item => {
			return {
				id: item.GroupName,
				application: item.GroupName,
				creationDate: item.CreationDate,
				description: item.Description,
				lastModifiedDate: item.LastModifiedDate,
				precedence: item.Precedence,
			}
		});
		// getList of React-admin expects response to have header called 'Content-Range'.
		// when we add new header in response, we have to acknowledge it, so 'Access-Control-Expose-Headers'

		resData.sort((a, b) => {
			if (a.id < b.id) return -1;
			if (a.id > b.id) return 1;
			return 0;
		});

		return {
			statusCode: 200,
			headers: {
				'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key,X-Tenant-Id,Content-Range,X-Requested-With',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'OPTIONS,GET,POST',
				'Access-Control-Expose-Headers': 'Content-Range',
				'Content-Range': `users ${startIdx + 1}-${startIdx + 1 + resData.length}`,
			},
			body: JSON.stringify({
				data: resData,
				total: resData.length,
				PaginationToken: NextToken
			}),
		}
	} catch (e) {
		console.log('Catch an error: ', e)
	}
	// TODO implement
	const response = {
		statusCode: 500,
		body: JSON.stringify('Service Error!'),
	};
	return response;
};
