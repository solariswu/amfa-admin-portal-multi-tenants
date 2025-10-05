//AWS configurations
import { CreateGroupCommand } from "@aws-sdk/client-cognito-identity-provider";

export const postResData = async (event, cognitoISP) => {
	const params = {
		GroupName: event.group.toLowerCase(),
		UserPoolId: process.env.USERPOOL_ID,
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