import {
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// Import shared auth utilities from lambda layer
import {
  validateGroupCreationPermission,
  getAvailableTAGroupsForRole,
} from "admin-auth";

// Assign groups/applications to user
const assignApplications = async (groups, username, cognitoISP) => {
  return Promise.all(
    groups.map((group) =>
      cognitoISP.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: process.env.USERPOOL_ID,
          GroupName: group,
          Username: username,
        }),
      ),
    ),
  );
};

// Password generation helper functions
function getRandomUpper() {
  return String.fromCharCode(Math.floor(Math.random() * 26) + 65);
}

function getRandomLower() {
  return String.fromCharCode(Math.floor(Math.random() * 26) + 97);
}

function getRandomNumber() {
  return String.fromCharCode(Math.floor(Math.random() * 10) + 48);
}

function getRandomSymbol() {
  const symbols = "!@#$%^&*(){}[]=<>/,.";
  return symbols[Math.floor(Math.random() * symbols.length)];
}

const randomFunc = {
  upper: getRandomUpper,
  lower: getRandomLower,
  number: getRandomNumber,
  symbol: getRandomSymbol,
};

function generatePassword(lower, upper, number, symbol, length) {
  console.log(lower, upper, number, symbol, length);
  let generatedPassword = "";
  const typesCount = lower + upper + number + symbol;
  const typesArr = [{ lower }, { upper }, { number }, { symbol }].filter(
    (item) => Object.values(item)[0],
  );
  
  if (typesCount === 0) {
    return false;
  }

  for (let i = 0; i < length; i += typesCount) {
    typesArr.forEach((type) => {
      const funcName = Object.keys(type)[0];
      generatedPassword += randomFunc[funcName]();
    });
  }
  
  return generatedPassword.slice(0, length);
}

// Main function to create user
export const postResData = async (data, cognitoISP, requesterRoles = []) => {
  console.log("postResData Input:", { data, requesterRoles });

  const groups = [];
  const attributes = [];

  Object.keys(data).map((key) => {
    switch (key.toLowerCase()) {
      case "locale":
      case "profile":
      case "given_name":
      case "family_name":
      case "name":
      case "middle_name":
      case "picture":
      case "gender":
      case "birthdate":
        if (data[key]) {
          attributes.push({ Name: key.toLowerCase(), Value: data[key] });
        }
        break;
      case "email":
        if (data[key]) {
          attributes.push({
            Name: key.toLowerCase(),
            Value: data[key].toLowerCase(),
          });
          attributes.push({ Name: "email_verified", Value: "true" });
        }
        break;
      case "phone_number":
        if (data[key]) {
          attributes.push({ Name: key.toLowerCase(), Value: data[key] });
          attributes.push({ Name: "phone_number_verified", Value: "true" });
        }
        break;
      case "phone_number_verified":
        if (data[key]) {
          attributes.push({
            Name: key.toLowerCase(),
            Value: data[key] ? "true" : "false",
          });
        }
        break;
      case "groups":
        groups.push(...data[key]);
        break;
      case "alter-email":
      case "voice-number":
        if (data[key]) {
          attributes.push({ Name: `custom:${key}`, Value: data[key] });
        }
        break;
      default:
        break;
    }
    return key;
  });

  // RBAC validation using shared function from lambda layer
  if (groups.length > 0) {
    const validation = await validateGroupCreationPermission(
      requesterRoles,
      groups,
      cognitoISP,
    );
    if (!validation.isValid) {
      throw new Error(`RBAC Validation Failed: ${validation.error}`);
    }
  }

  // Set email as verified to allow email login
  attributes.push({ Name: "email_verified", Value: "true" });

  attributes.push({
    Name: "nickname",
    Value: data["given_name"] + " " + data["family_name"],
  });

  const params = {
    Username: data["email"].trim(),
    ...(!data.notify && { MessageAction: "SUPPRESS" }),
    TemporaryPassword: generatePassword(true, true, true, true, 10),
    UserAttributes: attributes,
    UserPoolId: process.env.USERPOOL_ID,
    DesiredDeliveryMediums: ["EMAIL"],
  };

  const resData = await cognitoISP.send(new AdminCreateUserCommand(params));
  const item = resData.User;

  if (item) {
    if (groups && groups.length > 0) {
      // Remove SA from groups (SA users should not be created this way)
      let finalGroups = groups.filter((group) => group !== "SA");
      
      // Prioritize SPA_yyy roles - if multiple SPA_yyy roles, keep only the first one
      const spaGroups = finalGroups.filter(group => group.startsWith("SPA_"));
      if (spaGroups.length > 0) {
        finalGroups = [spaGroups[0]];
      }

      if (finalGroups.length > 0) {
        try {
          await assignApplications(finalGroups, item.Username, cognitoISP);
        } catch (err) {
          console.log("create user - assignApplications/groups Error:", err);
        }
      }
      
      // Update groups for response
      groups.length = 0;
      groups.push(...finalGroups);
    }

    const directMappingArrtibutes = [
      "email",
      "phone_number",
      "locale",
      "sub",
      "profile",
      "given_name",
      "family_name",
      "nickname",
      "name",
      "middle_name",
      "picture",
      "gender",
      "birthdate",
    ];
    const filteredAttributs = item.Attributes.filter((el) =>
      directMappingArrtibutes.includes(el.Name),
    );
    const result = Object.fromEntries(
      filteredAttributs.map((el) => [el.Name, el.Value]),
    );

    // Get email_verified and phone_number_verified from attributes
    const emailVerifiedAttr = item.Attributes.find(el => el.Name === "email_verified");
    const phoneVerifiedAttr = item.Attributes.find(el => el.Name === "phone_number_verified");

    return {
      id: item.Username,
      username: item.Username,
      enabled: item.Enabled,
      status: item.UserStatus,
      email_verified: emailVerifiedAttr?.Value === "true",
      phone_number_verified: phoneVerifiedAttr?.Value === "true",
      groups: groups.length > 0 ? groups : null,
      ...result,
    };
  }
};

// Export function to get available TA groups for frontend use
// Now using shared function from lambda layer
export { getAvailableTAGroupsForRole } from "admin-auth";

export default postResData;
