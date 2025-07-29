import {
  CognitoIdentityProviderClient,
  SetUICustomizationCommand,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
  CreateIdentityProviderCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const SUIDP_NAME = "SuperUserAdmin";

const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
});

const switchUserpoolTierToLite = async (UserPoolId) => {
  try {
    const describeUserPoolRes = await cognito.send(
      new DescribeUserPoolCommand({
        UserPoolId,
      }),
    );

    console.log("describeUserPoolRes:", describeUserPoolRes);

    const userPool = describeUserPoolRes.UserPool;

    if (!userPool) {
      throw new Error("UserPool not found");
    }

    if (userPool.UserPoolTier === "LITE") {
      console.log("admin userpool tier is LITE already");
      return userPool.Domain;
    }

    userPool.UserPoolTier = "LITE";
    delete userPool.CreationDate;
    delete userPool.LastModifiedDate;
    delete userPool.EstimatedNumberOfUsers;
    delete userPool.Id;
    delete userPool.Status;

    const param = {
      UserPoolId,
      ...userPool,
    };

    await cognito.send(new UpdateUserPoolCommand(param));

    return userPool.Domain;
  } catch (error) {
    console.error("switch userpool tier failed with:", error);
    console.error("RequestId: " + error.requestId);
  }

  return null;
};

const customiseUserpoolLogin = async (UserPoolId, ClientId) => {
  try {
    const logo_url =
      "https://downloads.apersona.com/downloads/aPersona_Logos_Package/aPLogo-370x67.png";
    const response = await fetch(logo_url);
    const buf = await response.arrayBuffer();

    const res = await cognito.send(
      new SetUICustomizationCommand({
        UserPoolId,
        ClientId,
        ImageFile: Buffer.from(buf), //blob,
      }),
    );

    console.log("set ui customization res:", res);
  } catch (error) {
    console.error("set ui customization failed with:", error);
    console.error("RequestId: " + error.requestId);
  }
};

const addSAMLProxyCallBacks = async () => {
  try {
    const res = await cognito.send(
      new DescribeUserPoolClientCommand({
        UserPoolId: process.env.USERPOOL_ID,
        ClientId: process.env.SAML_CLIENT_ID,
      }),
    );

    console.log("describe enduser pool client result:", response);

    let params = res.UserPoolClient;
    delete params.CreationDate;
    delete params.LastModifiedDate;
    delete params.ClientSecret;
    params.CallbackURLs.push(`${process.env.SAML_CALLBACK_URL}`);

    const response = await cognito.send(
      new UpdateUserPoolClientCommand(params),
    );

    console.log("update enduser poolclient result:", response);
  } catch (error) {
    console.error("describe user pool client failed with:", error);
    console.error("RequestId: " + error.requestId);
  }
};

const addSUIdPToAdminPool = async (UserPoolId, ClientId, IdPName) => {
  try {
    const res = await cognito.send(
      new DescribeUserPoolClientCommand({
        UserPoolId,
        ClientId,
      }),
    );

    let params = res.UserPoolClient;
    delete params.CreationDate;
    delete params.LastModifiedDate;
    delete params.ClientSecret;
    params.SupportedIdentityProviders.push(IdPName);

    const response = await cognito.send(
      new UpdateUserPoolClientCommand(params),
    );

    console.log("add SU Admin IdP to AdminPool result:", response);
  } catch (error) {
    console.error("addSUIdPToAdminPool failed with:", error);
    console.error("RequestId: " + error.requestId);
  }
};

const createSUIDP = async (domainName, UserPoolId) => {
  if (domainName) {
    console.log("domainName", domainName);
    console.log("process.env.SUAPI_ENDPOINT", process.env.SUAPI_ENDPOINT);

    try {
      // fetch POST request to SUAPI ENDPOINT and get clientid client secret back
      const response = await fetch(
        `${process.env.SUAPI_ENDPOINT}/${process.env.TENANT_ID}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            domain: domainName,
            region: process.env.AWS_REGION,
            tenantId: process.env.TENANT_ID,
          }),
        },
      );
      const data = await response.json();

      console.log("register SUAPI result", data);

      console.log("params:", {
        attributes_request_method: "GET",
        client_id: data.clientId,
        client_secret: data.clientSecret,
        oidc_issuer: data.issuer,
        authorize_scopes: "openid email profile",
      });

      if (response.ok) {
        const res = await cognito.send(
          new CreateIdentityProviderCommand({
            UserPoolId,
            ProviderName: SUIDP_NAME,
            ProviderType: "OIDC",
            ProviderDetails: {
              attributes_request_method: "GET",
              client_id: data.clientId,
              client_secret: data.clientSecret,
              oidc_issuer: data.issuer,
              authorize_scopes: "openid email profile",
            },
          }),
        );

        console.log("create SUIDP success:", res);
        return true;
      } else {
        console.error("failed to create SUIDP with error:", data);
      }
    } catch (error) {
      console.error("describe user pool client failed with:", error);
      console.error("RequestId: " + error.requestId);
    }
  }

  return false;
};

export const handler = async (event) => {
  const adminPoolDomainName = await switchUserpoolTierToLite(
    process.env.ADMINPOOL_ID,
  );
  await customiseUserpoolLogin(process.env.ADMINPOOL_ID, process.env.CLIENT_ID);
  await addSAMLProxyCallBacks();
  await createSUIDP(adminPoolDomainName, process.env.ADMINPOOL_ID);
  await addSUIdPToAdminPool(
    process.env.ADMINPOOL_ID,
    process.env.CLIENT_ID,
    SUIDP_NAME,
  );
};
