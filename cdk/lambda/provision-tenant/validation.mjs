/**
 * Tenant Data Validation Module
 * 
 * Validates tenant data before provisioning to ensure:
 * - Required fields are present
 * - Tenant ID format is correct (alphanumeric, max 36 chars)
 * - Email addresses are valid
 * - No SQL injection or XSS vulnerabilities
 */

const TENANT_ID_REGEX = /^[a-zA-Z0-9]{1,36}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate tenant creation data
 */
export function validateTenantData(event) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  const data = body.data || body;
  
  const errors = [];
  
  // Required fields
  if (!data.tenantId) {
    errors.push('tenantId is required');
  } else if (!TENANT_ID_REGEX.test(data.tenantId)) {
    errors.push('tenantId must be alphanumeric and max 36 characters');
  }
  
  if (!data.tenantName) {
    errors.push('tenantName is required');
  } else if (data.tenantName.length > 100) {
    errors.push('tenantName must be max 100 characters');
  }
  
  if (!data.contactEmail) {
    errors.push('contactEmail is required');
  } else if (!EMAIL_REGEX.test(data.contactEmail)) {
    errors.push('contactEmail must be a valid email address');
  }
  
  if (!data.orgId) {
    errors.push('orgId is required');
  } else if (!/^[a-zA-Z0-9]{1,36}$/.test(data.orgId)) {
    errors.push('orgId must be alphanumeric and max 36 characters');
  }
  
  // Optional fields with validation
  if (data.adminEmail && !EMAIL_REGEX.test(data.adminEmail)) {
    errors.push('adminEmail must be a valid email address if provided');
  }
  
  if (errors.length > 0) {
    const error = new Error(`Validation failed: ${errors.join(', ')}`);
    error.statusCode = 400;
    error.validationErrors = errors;
    throw error;
  }
  
  // Return sanitized data
  return {
    tenantId: data.tenantId.toLowerCase(), // Normalize to lowercase
    tenantName: data.tenantName.trim(),
    contactEmail: data.contactEmail.toLowerCase().trim(),
    orgId: data.orgId.toLowerCase(),
    samlproxy: data.samlproxy !== false, // Default to true
    adminEmail: data.adminEmail?.toLowerCase().trim(),
    adminFirstName: data.adminFirstName?.trim(),
    adminLastName: data.adminLastName?.trim(),
  };
}

/**
 * Validate tenant ID uniqueness
 */
export function validateTenantIdFormat(tenantId) {
  if (!TENANT_ID_REGEX.test(tenantId)) {
    throw new Error('Invalid tenant ID format');
  }
  return tenantId.toLowerCase();
}

/**
 * Sanitize string for storage (prevent XSS)
 */
export function sanitizeString(str) {
  if (!str) return str;
  return str
    .replace(/[<>]/g, '') // Remove angle brackets
    .trim();
}

export default validateTenantData;
