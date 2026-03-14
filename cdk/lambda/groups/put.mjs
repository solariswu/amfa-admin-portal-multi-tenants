import {
	UpdateGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

export const putResData = async (data, cognitoISP, userPoolId) => {
	console.log('putResData Input:', data);

	const params = {
		UserPoolId: userPoolId,
		GroupName: data.id.toLowerCase(),
		...(data.description && { Description: data.description }),
		...(data.precedence && { Precedence: data.precedence }),
	}

	const resData = await cognitoISP.send(new UpdateGroupCommand(params));
	const item = resData.Group;

	if (item) {

		return {
			id: item.GroupName,
			group: item.GroupName,
			creationDate: item.CreationDate,
			description: item.Description,
			lastModifiedDate: item.LastModifiedDate,
			precedence: item.Precedence,
		}
	}

	return null;
}

export default putResData;
