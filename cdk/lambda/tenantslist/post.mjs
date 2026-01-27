import {
	PutItemCommand,
} from '@aws-sdk/client-dynamodb';

export const postResData = async (payload, dynamodb) => {
	console.log('putResData Input:', payload);

	const params = {
		Item: {
			id: {
				S: payload.id,
			},
			name: {
				S: payload.name,
			},
			contact: {
				S: payload.contact,
			},
			url: {
				S: payload.url,
			},
			endUserSpUrl: {
				S: payload.endUserSpUrl,
			},
			samlproxy: {
				BOOL: payload.samlproxy
			},
			org_id: {
				S: payload.org_id || 'default' // Default to 'default' if not provided
			}
		},
		ReturnConsumedCapacity: 'TOTAL',
		TableName: `amfa-${this.account}-${this.region}-tenanttable`,
	};

	const item = await dynamodb.send(new PutItemCommand(params));

	if (item) {

		return {
			id: item.id,
			name: decodeURIComponent(item.name),
			contact: item.contact,
			samlproxy: item.samlproxy,
			url: item.url,
		}
	}

	return null;
}

export default postResData;
