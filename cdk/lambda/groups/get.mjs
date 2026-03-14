
//AWS configurations
import { GetGroupCommand } from "@aws-sdk/client-cognito-identity-provider";

export const getResData = async (GroupName, cognitoISP, userPoolId) => {

	const params = {
		GroupName,
		UserPoolId: userPoolId,
	};

	const data = await cognitoISP.send(new GetGroupCommand(params));
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

export default getResData;
