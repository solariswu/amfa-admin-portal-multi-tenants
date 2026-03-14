import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { validateTenantAccess, getTenantIdFromRequest, createResponse } from 'admin-auth';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

// Config types we manage in this Lambda
const CONFIG_TYPES = {
  amfaConfigs: 'amfaConfigs',
  amfaLegals: 'amfaLegals',
};

// Fields from amfaConfigs that we expose in the settings UI
// (excluding asmurl, asm_portal_url, and COMMENT fields)
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
 * Extract UI-facing settings from the full amfaConfigs + amfaLegals
 */
const buildSettingsResponse = (amfaConfigs, amfaLegals) => {
  const settings = {};

  // Extract amfaConfigs UI fields
  if (amfaConfigs) {
    AMFA_CONFIG_UI_FIELDS.forEach(field => {
      if (amfaConfigs[field] !== undefined) {
        settings[field] = amfaConfigs[field];
      }
    });
  }

  // Extract amfaLegals fields
  if (amfaLegals) {
    LEGAL_FIELDS.forEach(field => {
      if (amfaLegals[field] !== undefined) {
        settings[field] = amfaLegals[field];
      }
    });
  }

  return settings;
};

/**
 * Apply UI settings back to the full config objects, preserving non-UI fields
 */
const applySettingsToConfigs = (settings, existingAmfaConfigs, existingAmfaLegals) => {
  // Merge amfaConfigs: preserve existing non-UI fields, update UI fields
  const updatedAmfaConfigs = { ...(existingAmfaConfigs || {}) };
  AMFA_CONFIG_UI_FIELDS.forEach(field => {
    if (settings[field] !== undefined) {
      updatedAmfaConfigs[field] = settings[field];
    }
  });

  // Merge amfaLegals: update legal fields
  const updatedAmfaLegals = { ...(existingAmfaLegals || {}) };
  LEGAL_FIELDS.forEach(field => {
    if (settings[field] !== undefined) {
      updatedAmfaLegals[field] = settings[field];
    }
  });

  return { updatedAmfaConfigs, updatedAmfaLegals };
};

export const handler = async (event) => {
  console.info("Settings Lambda EVENT\n" + JSON.stringify(event, null, 2));

  // 1. Extract tenant_id from request path or header
  // Path parameter is {id} from /settings/{id}, so also check pathParameters.id
  const tenantId = getTenantIdFromRequest(event) || event.pathParameters?.id;

  if (!tenantId) {
    return createResponse(400, { error: 'tenant_id required in request' });
  }

  // 2. Validate authorization
  const authResult = await validateTenantAccess(event, tenantId);

  if (!authResult.authorized) {
    return createResponse(authResult.statusCode, { error: authResult.error });
  }

  console.log(`Authorized access for tenant ${tenantId}`);

  const httpMethod = event.requestContext?.http?.method || event.httpMethod || 'GET';

  try {
    if (httpMethod === 'GET') {
      // Fetch both config types
      const [amfaConfigs, amfaLegals] = await Promise.all([
        fetchConfig(CONFIG_TYPES.amfaConfigs, tenantId),
        fetchConfig(CONFIG_TYPES.amfaLegals, tenantId),
      ]);

      const settings = buildSettingsResponse(amfaConfigs, amfaLegals);

      return createResponse(200, { data: settings });

    } else if (httpMethod === 'PUT') {
      // Parse incoming settings
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      const incomingSettings = body.data;

      if (!incomingSettings) {
        return createResponse(400, { error: 'Missing data in request body' });
      }

      // Fetch existing configs to preserve non-UI fields
      const [existingAmfaConfigs, existingAmfaLegals] = await Promise.all([
        fetchConfig(CONFIG_TYPES.amfaConfigs, tenantId),
        fetchConfig(CONFIG_TYPES.amfaLegals, tenantId),
      ]);

      // Apply settings changes
      const { updatedAmfaConfigs, updatedAmfaLegals } = applySettingsToConfigs(
        incomingSettings,
        existingAmfaConfigs,
        existingAmfaLegals
      );

      // Save both config types
      await Promise.all([
        saveConfig(CONFIG_TYPES.amfaConfigs, tenantId, updatedAmfaConfigs),
        saveConfig(CONFIG_TYPES.amfaLegals, tenantId, updatedAmfaLegals),
      ]);

      // Return updated settings
      const settings = buildSettingsResponse(updatedAmfaConfigs, updatedAmfaLegals);
      return createResponse(200, { data: settings });

    } else {
      return createResponse(405, { error: `Method ${httpMethod} not allowed` });
    }
  } catch (err) {
    console.error('Settings Lambda error:', err);
    return createResponse(500, { type: 'exception', message: err.message || 'Internal server error' });
  }
};
