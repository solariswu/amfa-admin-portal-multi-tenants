import React from 'react';
import { Chip } from '@mui/material';

/**
 * RoleChip Component
 * 
 * Displays admin roles with color-coded visual indicators:
 * - SA (Super Admin): Red - Highest privilege
 * - SPA_xxx (Organization Admin): Blue - Organization scope
 * - TA_xxx (Tenant Admin): Orange - Tenant scope
 */
export const RoleChip = ({ role }) => {
  const getColor = () => {
    if (role === 'SA') return 'error';          // Red
    if (role.startsWith('SPA_')) return 'info'; // Blue
    if (role.startsWith('TA_')) return 'warning'; // Orange
    return 'default';
  };
  
  const getLabel = () => {
    if (role.startsWith('SPA_')) {
      const orgId = role.substring(4);
      return `SPA • ${orgId}`;
    }
    if (role.startsWith('TA_')) {
      const tenantId = role.substring(3);
      return `TA • ${tenantId}`;
    }
    return role;
  };
  
  return (
    <Chip 
      label={getLabel()} 
      color={getColor()} 
      size="small"
      sx={{ fontWeight: 500 }}
    />
  );
};

export default RoleChip;
