/**
 * Default configuration constants for new tenants.
 * These are written to amfa-configtable during tenant provisioning.
 * 
 * Config table schema:
 *   id (partition key): tenantId
 *   configtype (sort key): "amfaBrandings" | "amfaConfigs" | "amfaLegals" | "amfaPolicies"
 *   value: JSON string of the config object
 */

export const DEFAULT_AMFA_CONFIG = {
  "COMMENT-File": "This file contains the available primary AWS aPersona Adaptive MFA login settings.",
  asmurl: "",
  asm_portal_url: "",
  enable_password_reset: true,
  enable_self_service: true,
  enable_self_service_remove_buttons: true,
  enable_user_registration: true,
  enable_have_i_been_pwned: true,
  enable_google_recaptcha: false,
  "COMMENT-NOTE!!! Please Take care of using 'master_additional_otp_methods'": " 'e' would be always available for update profile and password reset, even if 'e' is not set. Available options are: 'e' for primary email, 'ae' for alt-email, 's' for sms, 'v' for voice, 't' for mobile soft token. Be sure to use double quotes.",
  master_additional_otp_methods: ["e", "ae", "s", "v", "t"],
  user_registration_default_group: "user",
  update_profile_force_mobile_token_first_if_registered: true,
  "COMMENT-totp": "The totp secrets and integration provider ID are located in the AWS secret manager",
  enable_password_expire: true,
  passwords_expire_days: 90,
  enable_prevent_password_reuse: true,
  prevent_password_reuse_count: 5,
  enable_auto_pwd_reset_on_threat: true,
};

export const DEFAULT_BRANDING_CONFIG = {
  service_name: "CompanyName",
  mobile_token_svc_name: "CompanyName",
  logo_url: "https://downloads.apersona.com/logos/logo-here_250x50.png",
  email_logo_url: "https://downloads.apersona.com/logos/logo-here_250x50.png",
  brand_base_color: "#7D8CA3",
  favicon_url: "https://downloads.apersona.com/logos/favicon.png",
};

export const DEFAULT_LEGAL_CONFIG = {
  terms_of_service: "https://downloads.apersona.com/demos/company-Ts-Cs.html",
  privacy_policy: "https://downloads.apersona.com/demos/company-privacy.html",
};

export const DEFAULT_SMTP_CONFIG = {
  service: "SMTP",
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: process.env.SMTP_PORT || "587",
  secure: process.env.SMTP_SECURE || "false",
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
};

/** Default permissions for user group policies */
const DEFAULT_PERMISSIONS = ["e", "ae", "s", "v", "t"];

/** Policy group names that are special (no rank/permissions) */
const SPECIAL_POLICY_GROUPS = ['pwd-reset', 'self-service', 'user-registration'];

/**
 * Build amfaPolicies from ASM apiKeys.
 * 
 * ASM returns apiKeys in the format:
 *   { "default": "default-50-1208a3bcee", "admin": "admin-5-7b9ebf83b8", ... }
 * 
 * For user group policies (default, admin, user, etc.):
 *   - Extract rank from the apiKey value (format: "name-rank-hash")
 *   - Add permissions and enable_passwordless fields
 * 
 * For special policies (pwd-reset, self-service, user-registration):
 *   - Only set policy_name (no rank/permissions needed)
 * 
 * @param {Object} apiKeys - API keys from ASM registration response
 * @returns {Object} amfaPolicies object
 */
export function buildPoliciesFromApiKeys(apiKeys) {
  if (!apiKeys || typeof apiKeys !== 'object' || Object.keys(apiKeys).length === 0) {
    console.warn('[Config] No apiKeys provided, returning empty policies');
    return {};
  }

  const policies = {};

  for (const [groupName, policyValue] of Object.entries(apiKeys)) {
    const policy = {
      policy_name: policyValue,
    };

    if (SPECIAL_POLICY_GROUPS.includes(groupName)) {
      // Special policies: only need policy_name
      policies[groupName] = policy;
      continue;
    }

    // User group policies: extract rank and add permissions
    // apiKey format: "name-rank-hash" e.g. "default-50-1208a3bcee"
    const parts = policyValue.split('-');
    if (parts.length >= 3) {
      // rank is the second-to-last part (before the hash)
      const rankCandidate = parseInt(parts[parts.length - 2], 10);
      if (!isNaN(rankCandidate)) {
        policy.rank = rankCandidate;
      }
    }

    policy.permissions = [...DEFAULT_PERMISSIONS];
    policy.enable_passwordless = false;

    policies[groupName] = policy;
  }

  console.log(`[Config] Built amfaPolicies with ${Object.keys(policies).length} groups:`, 
    Object.keys(policies).join(', '));

  return policies;
}

/**
 * Build tenant-specific configs with defaults
 * 
 * @param {string} tenantId - Tenant identifier
 * @param {string} tenantName - Display name for the tenant
 * @param {Object} asmData - ASM registration data (asmUrl, asmPortalUrl, apiKeys, etc.)
 * @returns {Array} Array of config items to write to DynamoDB
 */
export function buildTenantConfigs(tenantId, tenantName, asmData = {}) {
  // ASM URLs: use asmData if provided, otherwise fall back to env vars from tenants-config.json
  const asmServiceUrl = asmData.asmUrl || asmData.asmServiceUrl || process.env.ASM_SERVICE_URL || "";
  const asmPortalUrl = asmData.asmPortalUrl || process.env.ASM_PORTAL_URL || "";

  const configs = [
    {
      configtype: 'amfaBrandings',
      value: {
        ...DEFAULT_BRANDING_CONFIG,
        service_name: tenantName || tenantId,
        mobile_token_svc_name: tenantName || tenantId,
      }
    },
    {
      configtype: 'amfaConfigs',
      value: {
        ...DEFAULT_AMFA_CONFIG,
        asmurl: asmServiceUrl,
        asm_portal_url: asmPortalUrl,
      }
    },
    {
      configtype: 'amfaLegals',
      value: DEFAULT_LEGAL_CONFIG,
    },
  ];

  // Add amfaPolicies if apiKeys are available from ASM registration
  if (asmData.apiKeys && Object.keys(asmData.apiKeys).length > 0) {
    configs.push({
      configtype: 'amfaPolicies',
      value: buildPoliciesFromApiKeys(asmData.apiKeys),
    });
    console.log(`[Config] amfaPolicies included with ${Object.keys(asmData.apiKeys).length} API keys`);
  } else {
    console.warn('[Config] No apiKeys in asmData, amfaPolicies will NOT be written');
    console.warn('[Config] This may cause amfa-service Lambda errors at runtime');
  }

  return configs;
}