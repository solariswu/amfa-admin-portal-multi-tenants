/**
 * Role Utilities for Admin Portal
 * 
 * Extracts role and organization information from JWT tokens.
 * Roles are managed via Cognito User Groups:
 * - SA: Super Admin (group: "SA")
 * - SPA: Service Provider Admin (group: "SPA_<orgId>")
 */

/**
 * Extract role and org from JWT token cognito:groups claim
 * 
 * @param {string} token - JWT token from localStorage
 * @returns {Object} { role: 'SA' | 'SPA' | null, orgId: string | null }
 */
export function getRoleFromToken(token) {
  if (!token) {
    return { role: null, orgId: null };
  }

  try {
    // Decode JWT payload (base64)
    const payload = JSON.parse(atob(token.split('.')[1]));
    
    // Get cognito:groups array from token
    const groups = payload['cognito:groups'] || [];
    
    // Check for Super Admin
    if (groups.includes('SA')) {
      return { role: 'SA', orgId: null };
    }
    
    // Check for Service Provider Admin (SPA_<orgId> pattern)
    const spaGroup = groups.find(g => g.startsWith('SPA_'));
    if (spaGroup) {
      const orgId = spaGroup.substring(4); // Remove 'SPA_' prefix
      return { role: 'SPA', orgId };
    }
    
    // No recognized role
    return { role: null, orgId: null };
    
  } catch (error) {
    console.error('Failed to extract role from token:', error);
    return { role: null, orgId: null };
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
