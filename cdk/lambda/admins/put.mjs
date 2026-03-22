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

// Import shared ASM utilities from lambda layer
import {
    deregisterTAAdminFromASM,
    warnSPAAdminRemovalNotSynced,
} from "admin-auth";

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

    // Remove groups from Cognito
    await Promise.all(existingGroups.map((group) => deleteGroup(username, group, cognitoISP)));

    // Deregister removed TA/SPA roles from ASM Portal
    for (const group of existingGroups) {
        if (group.startsWith('TA_')) {
            const tenantId = group.substring(3);
            try {
                await deregisterTAAdminFromASM(
                    username.toLowerCase(),
                    tenantId,
                    username.toLowerCase(), // requestedBy
                );
            } catch (asmError) {
                console.error(`[ASM] Failed to deregister TA admin from ASM for tenant '${tenantId}' (non-fatal):`, asmError.message);
            }
        } else if (group.startsWith('SPA_')) {
            const orgId = group.substring(4);
            // TODO: Call ASM removeServiceProviderAdmin API once available.
            // Currently no ASM Portal endpoint exists to deregister an SPA admin.
            // The user is removed from Cognito but remains in ASM's service provider admin list.
            warnSPAAdminRemovalNotSynced(username, orgId);
        }
    }
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

        if (attributes.length > 0) {
            await cognitoISP.send(new AdminUpdateUserAttributesCommand({
                UserAttributes: attributes,
                Username: data.username,
                UserPoolId: process.env.USERPOOL_ID
            }));
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