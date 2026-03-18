import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { validateTenantAccess, getTenantIdFromRequest, createResponse } from 'admin-auth';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

// Fields from amfaConfigs that we expose in the settings UI
const AMFA_CONFIG_UI_FIELDS = [
  'enable_password_reset',
  'enable_self_service',
  'enable_self_service_remove_buttons',
  'enable_user_registration',
  'enable_have_i_been_pwned',
  'enable_google_recaptcha',
  'recaptcha_key',
  'recaptcha_secret',
  'master_additional_otp_methods',
  'user_registration_default_group',
  'update_profile_force_mobile_token_first_if_registered',
  'enable_password_expire',
  'passwords_expire_days',
  'enable_prevent_password_reuse',
  'prevent_password_reuse_count',
  'enable_auto_pwd_reset_on_threat',
];

// Fields from amfaLegals
const LEGAL_FIELDS = [
  'terms_of_service',
  'privacy_policy',
];

// Fields from amfaBrandings (Login Service branding)
const BRANDING_FIELDS = [
  'service_name',
  'mobile_token_svc_name',
  'logo_url',
  'email_logo_url',
  'brand_base_color',
  'favicon_url',
];

const fetchConfig = async (configType, tenantId) => {
  const params = {
    TableName: process.env.AMFACONFIG_TABLE,
    Key: {
      id: { S: tenantId },
      configtype: { S: configType },
    },
  };
  const result = await dynamodb.send(new GetItemCommand(params));
  if (result.Item?.value?.S) {
    return JSON.parse(result.Item.value.S);
  }
  return null;
};

const saveConfig = async (configType, tenantId, value) => {
  const params = {
    TableName: process.env.AMFACONFIG_TABLE,
    Item: {
      id: { S: tenantId },
      configtype: { S: configType },
      value: { S: JSON.stringify(value) },
    },
  };
  await dynamodb.send(new PutItemCommand(params));
};

/**
 * Build response from all config types
 */
const buildSettingsResponse = (amfaConfigs, amfaLegals, amfaBrandings) => {
  const settings = {};

  if (amfaConfigs) {
    AMFA_CONFIG_UI_FIELDS.forEach(field => {
      if (amfaConfigs[field] !== undefined) {
        settings[field] = amfaConfigs[field];
      }
    });
  }

  if (amfaLegals) {
    LEGAL_FIELDS.forEach(field => {
      if (amfaLegals[field] !== undefined) {
        settings[field] = amfaLegals[field];
      }
    });
  }

  if (amfaBrandings) {
    BRANDING_FIELDS.forEach(field => {
      if (amfaBrandings[field] !== undefined) {
        settings[field] = amfaBrandings[field];
      }
    });
  }

  return settings;
};

/**
 * Apply UI settings back to config objects, preserving non-UI fields
 */
const applySettingsToConfigs = (settings, existingAmfaConfigs, existingAmfaLegals, existingAmfaBrandings) => {
  const updatedAmfaConfigs = { ...(existingAmfaConfigs || {}) };
  AMFA_CONFIG_UI_FIELDS.forEach(field => {
    if (settings[field] !== undefined) {
      updatedAmfaConfigs[field] = settings[field];
    }
  });

  const updatedAmfaLegals = { ...(existingAmfaLegals || {}) };
  LEGAL_FIELDS.forEach(field => {
    if (settings[field] !== undefined) {
      updatedAmfaLegals[field] = settings[field];
    }
  });

  const updatedAmfaBrandings = { ...(existingAmfaBrandings || {}) };
  BRANDING_FIELDS.forEach(field => {
    if (settings[field] !== undefined) {
      updatedAmfaBrandings[field] = settings[field];
    }
  });

  return { updatedAmfaConfigs, updatedAmfaLegals, updatedAmfaBrandings };
};

export const handler = async (event) => {
  console.info("Settings Lambda EVENT\n" + JSON.stringify(event, null, 2));

  const tenantId = getTenantIdFromRequest(event) || event.pathParameters?.id;

  if (!tenantId) {
    return createResponse(400, { error: 'tenant_id required in request' });
  }

  const authResult = await validateTenantAccess(event, tenantId);
  if (!authResult.authorized) {
    return createResponse(authResult.statusCode, { error: authResult.error });
  }

  console.log(`Authorized access for tenant ${tenantId}`);

  const httpMethod = event.requestContext?.http?.method || event.httpMethod || 'GET';

  try {
    if (httpMethod === 'GET') {
      const [amfaConfigs, amfaLegals, amfaBrandings] = await Promise.all([
        fetchConfig('amfaConfigs', tenantId),
        fetchConfig('amfaLegals', tenantId),
        fetchConfig('amfaBrandings', tenantId),
      ]);

      const settings = buildSettingsResponse(amfaConfigs, amfaLegals, amfaBrandings);
      return createResponse(200, { data: settings });

    } else if (httpMethod === 'PUT') {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      const incomingSettings = body.data;

      if (!incomingSettings) {
        return createResponse(400, { error: 'Missing data in request body' });
      }

      const [existingAmfaConfigs, existingAmfaLegals, existingAmfaBrandings] = await Promise.all([
        fetchConfig('amfaConfigs', tenantId),
        fetchConfig('amfaLegals', tenantId),
        fetchConfig('amfaBrandings', tenantId),
      ]);

      const { updatedAmfaConfigs, updatedAmfaLegals, updatedAmfaBrandings } = applySettingsToConfigs(
        incomingSettings,
        existingAmfaConfigs,
        existingAmfaLegals,
        existingAmfaBrandings
      );

      await Promise.all([
        saveConfig('amfaConfigs', tenantId, updatedAmfaConfigs),
        saveConfig('amfaLegals', tenantId, updatedAmfaLegals),
        saveConfig('amfaBrandings', tenantId, updatedAmfaBrandings),
      ]);

      const settings = buildSettingsResponse(updatedAmfaConfigs, updatedAmfaLegals, updatedAmfaBrandings);
      return createResponse(200, { data: settings });

    } else {
      return createResponse(405, { error: `Method ${httpMethod} not allowed` });
    }
  } catch (err) {
    console.error('Settings Lambda error:', err);
    return createResponse(500, { type: 'exception', message: err.message || 'Internal server error' });
  }
};
