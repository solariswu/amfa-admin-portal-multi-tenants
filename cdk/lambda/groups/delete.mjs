
//AWS configurations
import { DeleteGroupCommand } from "@aws-sdk/client-cognito-identity-provider";

export const deleteResData = async (GroupName, cognitoISP, userPoolId) => {
	const params = {
		GroupName,
		UserPoolId: userPoolId,
	};

	const data = await cognitoISP.send(new DeleteGroupCommand(params));
	const item = data.Group;

	return {
		id: item.GroupName,
	};

};

export default deleteResData;
