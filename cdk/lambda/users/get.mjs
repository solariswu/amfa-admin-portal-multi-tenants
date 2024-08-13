import { AdminGetUserCommand, AdminListGroupsForUserCommand } from "@aws-sdk/client-cognito-identity-provider";

export const getResData = async (username, cognitoISP) => {

	const params = {
		Username: username,
		UserPoolId: process.env.USERPOOL_ID,
	};
	const item = await cognitoISP.send(new AdminGetUserCommand(params));

	const data = await cognitoISP.send(new AdminListGroupsForUserCommand({
		UserPoolId: process.env.USERPOOL_ID,
		Limit: 60,
		Username: item.Username
	}));

	let groups = null;

	if (data.Groups && data.Groups.length > 0) {
		groups = data.Groups.map(item => item.GroupName);
		groups = groups.filter(item => !item.startsWith(`${process.env.USERPOOL_ID}_`));
	}

	const email_verified = item.UserAttributes.find(attr => attr.Name === "email_verified")?.Value;
	const phone_number_verified = item.UserAttributes.find(attr => attr.Name === "phone_number_verified")?.Value;
	const preferredMfaSetting = item.PreferredMfaSetting;
	const hasMobileToken = item.UserAttributes.find(attr => attr.Name === "custom:totp-label")?.Value;

	const directMappingArrtibutes = [
		'email', 'phone_number', 'locale', 'sub', 'profile', 'given_name', 'family_name',
		'nickname', 'name', 'middle_name', 'picture', 'profile', 'gender', 'birthdate', 'address'];
	const filteredAttributs = item.UserAttributes.filter (el => directMappingArrtibutes.includes(el.Name));
	const result = Object.fromEntries(filteredAttributs.map(el => [el.Name, el.Value]))

	return {
		id: item.Username,
		username: item.Username,
		email_verified: email_verified === 'true' ? true : false,
		phone_number_verified: phone_number_verified === 'true' ? true : false,
		groups: groups ? groups : null,
		sms_mfa_enabled: preferredMfaSetting === 'SMS_MFA' ? true : false,
		totp_mfa_enabled: preferredMfaSetting === 'SOFTWARE_TOKEN_MFA' ? true : false,
		enabled: item.Enabled,
		status: item.UserStatus,
		'alter-email': item.UserAttributes.find(attr => attr.Name === "custom:alter-email")?.Value,
		'voice-number': item.UserAttributes.find(attr => attr.Name === "custom:voice-number")?.Value,
		hasMobileToken: hasMobileToken && hasMobileToken.length > 0 ? true : false,
		...result
	}
}

export default getResData;