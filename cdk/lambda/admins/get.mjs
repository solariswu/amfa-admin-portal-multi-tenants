import { AdminGetUserCommand, AdminListGroupsForUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import https from "https";

export const getResData = async (username, cognitoISP) => {

	const defaultOptions = {
		host: `api.${process.env.AMFA_BASE_URL}`,
		port: 443, // or 443 for https
		headers: {
			'Content-Type': 'application/json',
		}
	}

	const checkLicense = (email) => new Promise((resolve, reject) => {
		const options = { ...defaultOptions, path: '/amfa', method: 'POST' };
		const req = https.request(options, res => {
			let buffer = "";
			res.on('data', chunk => buffer += chunk)
			res.on('end', () => resolve(res.statusCode))//JSON.parse(buffer)))
			console.log('statusCode:', res.statusCode);
		});
		req.on('error', e => reject(e.message));
		req.write(JSON.stringify({ email, phase: "adminchecklicense" }));
		req.end();
	})

	const params = {
		Username: username,
		UserPoolId: process.env.USERPOOL_ID,
	};
	const item = await cognitoISP.send(new AdminGetUserCommand(params));

	const email = item.UserAttributes.find(attr => attr.Name === "email")?.Value;

	const [groupRes, licenseRes] = await Promise.allSettled([
		cognitoISP.send(new AdminListGroupsForUserCommand({
			UserPoolId: process.env.USERPOOL_ID,
			Limit: 60,
			Username: item.Username
		})),
		checkLicense(email)]);

	console.log('get user group result', groupRes)
	console.log('get user license result', licenseRes)

	let groups = null;
	let license = false;

	if (groupRes.status !== 'rejected') {

		const data = groupRes.value;

		if (data.Groups && data.Groups.length > 0) {
			groups = data.Groups.map(item => item.GroupName);
			groups = groups.filter(item => !item.startsWith(`${process.env.USERPOOL_ID}_`));
		}

	}

	if (licenseRes.status !== 'rejected') {
		const data = await licenseRes.value;
		console.log('license data', data);
		/* 
			{"code":200,"message":"Active","info":"License is valid","identifier":null,"isUserUnderThreat":null,"platform":null}
			{"code":203,"message":"Exceeds Allowed Users","info":"Exceed number of users allowed for validation","identifier":null,"isUserUnderThreat":null,"platform":null}
			{"code":404,"message":"User not found.","info":"User not yet registered.","identifier":null,"isUserUnderThreat":null,"platform":null}
			Only show the warning messages if the return code is: 203.
		*/
		license = data === 203 ? false : true;
	}

	const email_verified = item.UserAttributes.find(attr => attr.Name === "email_verified")?.Value;
	const phone_number_verified = item.UserAttributes.find(attr => attr.Name === "phone_number_verified")?.Value;
	const preferredMfaSetting = item.PreferredMfaSetting;
	const hasMobileToken = item.UserAttributes.find(attr => attr.Name === "custom:totp-label")?.Value;

	const directMappingArrtibutes = [
		'email', 'phone_number', 'locale', 'sub', 'profile', 'given_name', 'family_name',
		'nickname', 'name', 'middle_name', 'picture', 'profile', 'gender', 'birthdate' /*,'address'*/];
	const filteredAttributs = item.UserAttributes.filter(el => directMappingArrtibutes.includes(el.Name));
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
		license,
		...result
	}
}

export default getResData;