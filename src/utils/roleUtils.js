/**
 * Role Utilities for Admin Portal
 * 
 * Extracts role and organization information from JWT tokens.
 * Roles are managed via Cognito User Groups:
 * - SA: Super Admin (group: "SA")
 * - SPA: Service Provider Admin (group: "SPA_<orgId>")
 * - TA: Tenant Admin (group: "TA_<tenantId>")
 */

/**
 * Get role type from groups array
 * Priority: SA > SPA > TA
 * 
 * @param {Array<string>} groups - Array of Cognito group names
 * @returns {'SA' | 'SPA' | 'TA' | null} Role type
 */
export function getRoleType(groups) {
  if (!groups || groups.length === 0) return null;
  if (groups.includes('SA')) return 'SA';
  if (groups.find(g => g.startsWith('SPA_'))) return 'SPA';
  if (groups.find(g => g.startsWith('TA_'))) return 'TA';
  return null;
}

/**
 * Get organization ID from SPA_xxx role
 * 
 * @param {Array<string>} groups - Array of Cognito group names
 * @returns {string | null} Organization ID or null
 */
export function getOrgId(groups) {
  const spaGroup = groups?.find(g => g.startsWith('SPA_'));
  return spaGroup ? spaGroup.substring(4) : null;
}

/**
 * Get tenant ID from TA_xxx role (returns first TA role if multiple)
 * 
 * @param {Array<string>} groups - Array of Cognito group names
 * @returns {string | null} Tenant ID or null
 */
export function getTenantId(groups) {
  const taGroup = groups?.find(g => g.startsWith('TA_'));
  return taGroup ? taGroup.substring(3) : null;
}

/**
 * Get all tenant IDs for users with multiple TA roles
 * 
 * @param {Array<string>} groups - Array of Cognito group names
 * @returns {Array<string>} Array of tenant IDs
 */
export function getAllTenantIds(groups) {
  return groups
    ?.filter(g => g.startsWith('TA_'))
    .map(g => g.substring(3)) || [];
}

/**
 * Extract role and org from JWT token cognito:groups claim
 * 
 * @param {string} token - JWT token from localStorage
 * @returns {Object} { role: 'SA' | 'SPA' | 'TA' | null, orgId: string | null, tenantId: string | null, groups: Array<string> }
 */
export function getRoleFromToken(token) {
  if (!token) {
    return { role: null, orgId: null, tenantId: null, groups: [] };
  }

  try {
    // Decode JWT payload (base64)
    const payload = JSON.parse(atob(token.split('.')[1]));
    
    // Get cognito:groups array from token
    const groups = payload['cognito:groups'] || [];
    
    const roleType = getRoleType(groups);
    const orgId = getOrgId(groups);
    const tenantId = getTenantId(groups);
    
    return { 
      role: roleType, 
      orgId, 
      tenantId,
      groups 
    };
    
  } catch (error) {
    console.error('Failed to extract role from token:', error);
    return { role: null, orgId: null, tenantId: null, groups: [] };
  }
}

/**
 * Check if user has Super Admin role
 * 
 * @param {string} token - JWT token
 * @returns {boolean}
 */
export function isSuperAdmin(token) {
  const { role } = getRoleFromToken(token);
  return role === 'SA';
}

/**
 * Check if user has Service Provider Admin role
 * 
 * @param {string} token - JWT token
 * @returns {boolean}
 */
export function isServiceProviderAdmin(token) {
  const { role } = getRoleFromToken(token);
  return role === 'SPA';
}

/**
 * Check if user has Tenant Admin role
 * 
 * @param {string} token - JWT token
 * @returns {boolean}
 */
export function isTenantAdmin(token) {
  const { role } = getRoleFromToken(token);
  return role === 'TA';
}

/**
 * Get user's organization ID (for SPAs)
 * 
 * @param {string} token - JWT token
 * @returns {string|null} Organization ID or null
 */
export function getUserOrgId(token) {
  const { orgId } = getRoleFromToken(token);
  return orgId;
}

/**
 * Get user's tenant ID (for TAs)
 * 
 * @param {string} token - JWT token
 * @returns {string|null} Tenant ID or null
 */
export function getUserTenantId(token) {
  const { tenantId } = getRoleFromToken(token);
  return tenantId;
}

/**
 * Check if user can manage a specific organization
 * 
 * @param {string} token - JWT token
 * @param {string} orgId - Organization ID to check
 * @returns {boolean}
 */
export function canManageOrg(token, orgId) {
  const { role, orgId: userOrgId } = getRoleFromToken(token);
  
  // SA can manage any org
  if (role === 'SA') {
    return true;
  }
  
  // SPA can only manage their own org
  if (role === 'SPA' && userOrgId === orgId) {
    return true;
  }
  
  return false;
}

/**
 * Check if user can create tenants
 * 
 * @param {string} token - JWT token
 * @returns {boolean}
 */
export function canCreateTenants(token) {
  const { role } = getRoleFromToken(token);
  return role === 'SA' || role === 'SPA';
}

/**
 * Check if user can delete tenants (SA only)
 * 
 * @param {string} token - JWT token
 * @returns {boolean}
 */
export function canDeleteTenants(token) {
  return isSuperAdmin(token);
}

/**
 * Check if user can create organizations (SA only)
 * 
 * @param {string} token - JWT token
 * @returns {boolean}
 */
export function canCreateOrganizations(token) {
  return isSuperAdmin(token);
}

/**
 * Check if user can manage organizations (SA only)
 * 
 * @param {string} token - JWT token
 * @returns {boolean}
 */
export function canManageOrganizations(token) {
  return isSuperAdmin(token);
}

export default getRoleFromToken;
