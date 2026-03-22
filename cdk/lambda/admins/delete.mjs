import {
    AdminDeleteUserCommand,
    AdminGetUserCommand,
    AdminListGroupsForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// Import shared ASM utilities from lambda layer
import {
    deregisterTAAdminFromASM,
    warnSPAAdminRemovalNotSynced,
} from "admin-auth";

export const deleteResData = async (data, cognitoISP, admin) => {
    console.log('deleteResData Input:', data);

    if (!data || !data.id) {
        return {
            id: 0,
        }
    }

    const user = await cognitoISP.send(new AdminGetUserCommand({
        Username: data.id,
        UserPoolId: process.env.USERPOOL_ID
    }))

    console.log('get user before delete User:', user);

    // Step 1: Get user's current groups BEFORE deleting from Cognito
    // so we can deregister from ASM for any TA/SPA roles
    let userGroups = [];
    let userEmail = data.id; // fallback to username
    try {
        const groupsResult = await cognitoISP.send(new AdminListGroupsForUserCommand({
            Username: data.id,
            UserPoolId: process.env.USERPOOL_ID,
        }));
        userGroups = (groupsResult.Groups || []).map(g => g.GroupName);
        console.log(`[ASM] User '${data.id}' groups before deletion:`, userGroups);

        // Extract email from user attributes
        const emailAttr = (user.UserAttributes || []).find(a => a.Name === 'email');
        if (emailAttr) {
            userEmail = emailAttr.Value;
        }
    } catch (groupsError) {
        console.warn(`[ASM] Failed to list groups for user '${data.id}' (non-fatal):`, groupsError.message);
    }

    // Step 2: Delete user from Cognito
    const result = await cognitoISP.send(new AdminDeleteUserCommand({
        Username: data.id,
        UserPoolId: process.env.USERPOOL_ID,
    }));
    console.log('deleteResData Output:', result);

    // Step 3: Deregister from ASM for any TA roles
    for (const group of userGroups) {
        if (group.startsWith('TA_')) {
            const tenantId = group.substring(3);
            try {
                await deregisterTAAdminFromASM(
                    userEmail.toLowerCase(),
                    tenantId,
                    admin || userEmail.toLowerCase(),
                );
            } catch (asmError) {
                console.error(`[ASM] Failed to deregister TA admin from ASM for tenant '${tenantId}' (non-fatal):`, asmError.message);
            }
        } else if (group.startsWith('SPA_')) {
            const orgId = group.substring(4);
            // TODO: Call ASM removeServiceProviderAdmin API once available.
            // Currently no ASM Portal endpoint exists to deregister an SPA admin.
            // The user is removed from Cognito but remains in ASM's service provider admin list.
            warnSPAAdminRemovalNotSynced(userEmail, orgId);
        }
    }

    return {
        id: data.id,
    }
}

export default deleteResData;
