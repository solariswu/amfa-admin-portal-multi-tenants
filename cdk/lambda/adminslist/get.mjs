import {
    AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

export const getResData = async (item, cognitoISP) => {
    let groups = null;

    try {
        const data = await cognitoISP.send(new AdminListGroupsForUserCommand(
            {
                UserPoolId: process.env.USERPOOL_ID,
                Limit: 60,
                Username: item.Username
            }));

        if (data.Groups && data.Groups.length > 0) {
            groups = data.Groups.map(item => item.GroupName);
            groups = groups.filter(item => !item.startsWith(`${process.env.USERPOOL_ID}_`));
        }
    }
    catch (err) {
        console.log(err);
    }

    const email_verified = item.Attributes.find(attr => attr.Name === "email_verified")?.Value;
    const phone_number_verified = item.Attributes.find(attr => attr.Name === "phone_number_verified")?.Value;
    const preferredMfaSetting = item.PreferredMfaSetting;
    const hasMobileToken = item.Attributes.find(attr => attr.Name === "custom:totp-label")?.Value;

    return {
        id: item.Username,
        username: item.Username,
        email: item.Attributes.find(attr => attr.Name === "email")?.Value,
        email_verified: email_verified === 'true' ? true : false,
        phone_number: item.Attributes.find(attr => attr.Name === "phone_number")?.Value,
        phone_number_verified: phone_number_verified === 'true' ? true : false,
        locale: item.Attributes.find(attr => attr.Name === "locale")?.Value,
        sub: item.sub ? item.sub : item.Attributes.find(attr => attr.Name === "sub")?.Value,
        groups: groups ? groups : null,
        profile: item.Attributes.find(attr => attr.Name === "profile")?.Value,
        given_name: item.Attributes.find(attr => attr.Name === "given_name")?.Value,
        family_name: item.Attributes.find(attr => attr.Name === "family_name")?.Value,
        nickname: item.Attributes.find(attr => attr.Name === "nickname")?.Value,
        enabled: item.Enabled,
        status: item.UserStatus,
        sms_mfa_enabled: preferredMfaSetting === 'SMS_MFA' ? true : false,
        totp_mfa_enabled: preferredMfaSetting === 'SOFTWARE_TOKEN_MFA' ? true : false,
        totp_label: item.Attributes.find(attr => attr.Name === "totp_label")?.Value,
        'alter-email': item.Attributes.find(attr => attr.Name === "custom:alter-email")?.Value,
        'voice-number': item.Attributes.find(attr => attr.Name === "custom:voice-number")?.Value,
        hasMobileToken: hasMobileToken && hasMobileToken.length > 0 ? true : false
    }
}

export default getResData;