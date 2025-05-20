import getResData from "./get.mjs";
import {
    AdminUpdateUserAttributesCommand,
    AdminAddUserToGroupCommand,
    AdminRemoveUserFromGroupCommand,
    AdminSetUserMFAPreferenceCommand,
    AdminEnableUserCommand,
    AdminDisableUserCommand,
    AdminResetUserPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const postURL = `https://api.${process.env.AMFA_BASE_URL}/amfa`;

const notifyAmfa = async (userEmail, phase, otptype, newProfileValue) => {

    const amfaResponse = await fetch(postURL, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Origin': `https://${process.env.AMFA_BASE_URL}`,
        },
        body: JSON.stringify({ email: userEmail, phase, otptype, newProfileValue }),
    });

    return amfaResponse;
}

const assignGroup = async (username, group, cognitoISP) => {
    return await cognitoISP.send(new AdminAddUserToGroupCommand({
        UserPoolId: process.env.USERPOOL_ID,
        GroupName: group,
        Username: username
    }));
}

const deleteGroup = async (username, group, cognitoISP) => {
    return cognitoISP.send(new AdminRemoveUserFromGroupCommand({
        UserPoolId: process.env.USERPOOL_ID,
        GroupName: group,
        Username: username
    }));
}

const addNewGroups = async (username, existingGroups, newGroups, cognitoISP) => {
    if (newGroups && newGroups.length !== 0 && existingGroups && existingGroups.length !== 0) {
        // existing groups no need to be added
        newGroups = newGroups.filter(t => !existingGroups.includes(t))
    }

    if (!newGroups || newGroups.length === 0) {
        // nothing new
        return;
    }

    return Promise.all(newGroups.map((group) => assignGroup(username, group, cognitoISP)))
}

const removeGroups = async (username, existingGroups, newGroups, cognitoISP) => {
    if (existingGroups && existingGroups.length !== 0 && newGroups && newGroups.length !== 0) {
        // keep the groups in newGroups
        existingGroups = existingGroups.filter(t => !newGroups.includes(t))
    }

    if (!existingGroups || existingGroups.length === 0) {
        //nothing to remove
        return;
    }

    return Promise.all(existingGroups.map((group) => deleteGroup(username, group, cognitoISP)))
}

export const putResData = async (data, cognitoISP) => {
    console.log('putResData Input:', data);

    const attributes = [];

    if (data.username) {
        const user = await getResData(data.username, cognitoISP);

        // disable/enable user
        if (user.enabled !== data.enabled) {
            const params = {
                Username: data.username,
                UserPoolId: process.env.USERPOOL_ID,
            }
            const command = data.enabled ? new AdminEnableUserCommand(params) : new AdminDisableUserCommand(params);

            await cognitoISP.send(command);

            let newData = data;
            newData.enabled = data.enabled;
            return newData;
        }

        if (data.resetpassword) {
            const params = {
                Username: data.username,
                UserPoolId: process.env.USERPOOL_ID,
            }

            await cognitoISP.send(new AdminResetUserPasswordCommand(params));

            let newData = data;
            newData.resetpassword = false;
            return newData;
        }

        // update user groups
        await addNewGroups(data.username, user.groups, data.groups, cognitoISP);
        await removeGroups(data.username, user.groups, data.groups, cognitoISP);
        user.groups = data.groups;

        let changedOtpTypes = [];
        let newOtpValues = [];
        data.nickname = data.given_name + ' ' + data.family_name;

        // user attributes non-mfa related
        const attributesList = ['locale', 'middle_name',
            'name', 'profile', 'picture', 'gender', 'birthdate',
            /*'address',*/ 'family_name', 'given_name', 'nickname'];
        // update user attributes
        attributesList.map(attributeName => {
            const newValue = data[attributeName] ? data[attributeName] : '';
            // user attribute is not undefine then it can compare with newValue
            // user attribute is undefine and newValue is not empty, then they can compare
            if (newValue !== '' || user[attributeName]) {
                if (user[attributeName] != newValue) {
                    attributes.push({ "Name": attributeName, "Value": newValue });
                    user[attributeName] = newValue;
                }
            }
        })

        // user attributes MFA related

        // used for compare undefine, '', null all togther
        let valueA = user.email ? user.email : '';
        let valueB = data.email ? data.email : '';

        if (valueA != valueB) {
            attributes.push({ "Name": 'email', "Value": data.email ? data.email : '' });
            user.email = data.email;
            if (data.email && email.trim().length > 0) {
                attributes.push({ "Name": 'email_verified', "Value": 'true' });
                user.email_verified = true;
            }
        }

        valueA = user.phone_number ? user.phone_number : '';
        valueB = data.phone_number ? data.phone_number : '';

        if (valueA != valueB) {
            attributes.push({ "Name": 'phone_number', "Value": data.phone_number ? data.phone_number : '' });
            user.phone_number = data.phone_number;
            if (data.phone_number && data.phone_number.trim().length > 0) {
                attributes.push({ "Name": 'phone_number_verified', "Value": 'true' });
                user.phone_number_verified = true;
            }

            changedOtpTypes.push('Phone number');
            newOtpValues.push(data.phone_number);
        }

        valueA = user['alter-email'] ? user['alter-email'] : ''
        valueB = data['alter-email'] ? data['alter-email'] : ''

        if (valueA != valueB) {
            attributes.push({ "Name": 'custom:alter-email', "Value": data['alter-email'] ? data['alter-email'] : '' });
            user['alter-email'] = data['alter-email'];

            changedOtpTypes.push('Alt Email');
            newOtpValues.push(data['alter-email']);
        }

        valueA = user['voice-number'] ? user['voice-number'] : ''
        valueB = data['voice-number'] ? data['voice-number'] : ''

        if (valueA != valueB) {
            attributes.push({ "Name": 'custom:voice-number', "Value": data['voice-number'] ? data['voice-number'] : '' });
            user['voice-number'] = data['voice-number'];

            changedOtpTypes.push('Voice Mail')
            newOtpValues.push(data['voice-number'])
        }

        if (user.hasMobileToken && !data.hasMobileToken) {
            // remove user mobile token
            // todo update amfa side
            attributes.push({ "Name": 'custom:totp-label', "Value": '' });
            user.hasMobileToken = false;

            const amfaResponse = notifyAmfa(data.email, 'admindeletetotp');
            await new Promise(r => setTimeout(r, 1000));

            console.log('delete totp amfa api response', amfaResponse);
        }

        if (attributes.length > 0) {
            await cognitoISP.send(new AdminUpdateUserAttributesCommand({
                UserAttributes: attributes,
                Username: data.username,
                UserPoolId: process.env.USERPOOL_ID
            }));
        }

        if (changedOtpTypes.length > 0) {
            const amfaResponse = notifyAmfa(data.email, 'adminupdateuser', changedOtpTypes, newOtpValues);
            await new Promise(r => setTimeout(r, 1000));
            console.log('notify amfa update user response', amfaResponse);
        }

        if (user.sms_mfa_enabled !== data.sms_mfa_enabled) {
            await cognitoISP.send(new AdminSetUserMFAPreferenceCommand({
                SMSMfaSettings: {
                    Enabled: data.sms_mfa_enabled,
                    PreferredMfa: true
                },
                Username: data.username,
                UserPoolId: process.env.USERPOOL_ID
            }));
        }

        return user;
    }
    return data;
}

export default putResData;