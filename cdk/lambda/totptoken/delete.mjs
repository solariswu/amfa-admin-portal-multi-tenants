import { DeleteItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { AdminUpdateUserAttributesCommand } from "@aws-sdk/client-cognito-identity-provider";
import { notifyProfileChange } from "./mailer.mjs";

const fetchConfig = async (configType, dynamodb) => {
  const params = {
    TableName: process.env.AMFACONFIG_TABLE,
    Key: {
      configtype: { S: configType },
    },
  };
  const getItemCommand = new GetItemCommand(params);
  const results = await dynamodb.send(getItemCommand);

  if (results.Item === undefined) {
    throw new Error(`No ${configType} found`);
  }

  const result = JSON.parse(results.Item.value.S);

  console.log(`get ${configType}:`, result);
  return result;
};

export const deleteResData = async (payload, dynamodb, cognito) => {
  console.log("delete all old token from db");

  const email = payload.email.trim().toLowerCase();
  const tenantId = payload.tenantId.trim();

  const params = {
    TableName: process.env.TOTPTOKEN_TABLE + tenantId,
    Key: {
      id: { S: email + "#" + payload.pid.trim() },
    },
    ReturnValues: "ALL_OLD",
  };

  const getRes = await dynamodb.send(new GetItemCommand(params));
  console.log("delete totp - count items from db result", getRes);

  if (getRes.Item) {
    const delRes = await dynamodb.send(new DeleteItemCommand(params));
    console.log("delete totp from db result", delRes);

    try {
      await cognito.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: process.env.USERPOOL_ID,
          Username: email,
          UserAttributes: [
            {
              Name: "custom:totp-label",
              Value: "",
            },
          ],
        }),
      );
    } catch (error) {
      console.log("error", error);
    }

    const amfaBrandings = await fetchConfig("amfaBrandings", dynamodb);

    await notifyProfileChange(
      email,
      ["Mobile TOTP"],
      [null],
      amfaBrandings.email_logo_url,
      amfaBrandings.service_name,
      true,
    );

    return 1;
  }

  return 0;
};
