//AWS configurations
import { CreateGroupCommand } from "@aws-sdk/client-cognito-identity-provider";

export const postResData = async (event, cognitoISP, userPoolId) => {
	const params = {
		GroupName: event.group.toLowerCase(),
		UserPoolId: userPoolId,
		...(event.description && { Description: event.description }),
	};

	const data = await cognitoISP.send(new CreateGroupCommand(params));
	const item = data.Group;

	return {
		id: item.GroupName,
		group: item.GroupName,
		creationDate: item.CreationDate,
		description: item.Description,
		lastModifiedDate: item.LastModifiedDate,
		precedence: item.Precedence,
	};

};

export default postResData;
