import React from 'react';
import { usePermissions } from 'react-admin';
import { Box, Card, CardContent, Typography } from '@mui/material';
import DomainIcon from '@mui/icons-material/Domain';
import { useTenantContext } from '../contexts/TenantContext';

/**
 * SelectTenantPrompt
 * 
 * Displays a friendly prompt when SA/SPA users haven't selected a tenant yet.
 * For TA users (auto-selected tenant), this is never shown.
 * 
 * Can be used as:
 * - A Dashboard component
 * - A guard wrapper around tenant-scoped pages
 */
export const SelectTenantPrompt = ({ children }) => {
  const { isTenantSelected } = useTenantContext();
  const { permissions, isLoading } = usePermissions();

  if (isLoading) return null;

  // TA users always have a tenant — show children directly
  if (permissions?.isTA) {
    return children || null;
  }

  // SA/SPA without tenant selected — show prompt
  if (!isTenantSelected) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <Card sx={{ maxWidth: 480, width: '100%' }}>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <DomainIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              No Tenant Selected
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Select a tenant from the sidebar menu to manage its users, groups, 
              brandings, and service providers.
            </Typography>
            <Typography variant="caption" color="text.disabled">
              Use the tenant dropdown in the left sidebar to get started.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    );
  }

  // Tenant is selected — show children
  return children || null;
};

/**
 * Dashboard component for the admin portal.
 * Shows different content based on role and tenant selection.
 */
export const AmfaDashboard = () => {
  const { isTenantSelected, selectedTenantName, selectedTenantId } = useTenantContext();
  const { permissions, isLoading } = usePermissions();

  if (isLoading) return null;

  const roleName = permissions?.isSA
    ? 'Super Admin'
    : permissions?.isSPA
      ? 'Service Provider Admin'
      : permissions?.isTA
        ? 'Tenant Admin'
        : 'Admin';

  // SA/SPA without tenant — show prompt
  if (!isTenantSelected && !permissions?.isTA) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <Card sx={{ maxWidth: 520, width: '100%' }}>
          <CardContent sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="h5" gutterBottom>
              Welcome, {roleName}
            </Typography>
            <DomainIcon sx={{ fontSize: 64, color: 'text.disabled', my: 2 }} />
            <Typography variant="body1" gutterBottom>
              Select a tenant to get started
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Use the tenant dropdown in the left sidebar to choose which tenant 
              you want to manage. You'll then be able to access users, groups, 
              brandings, and service providers for that tenant.
            </Typography>
            {permissions?.isSA && (
              <Typography variant="caption" color="text.disabled">
                As a Super Admin, you can also manage IT Service Organizations and 
                Tenants from the sidebar navigation.
              </Typography>
            )}
            {permissions?.isSPA && (
              <Typography variant="caption" color="text.disabled">
                As a Service Provider Admin, you can also manage Tenants within 
                your organization from the sidebar navigation.
              </Typography>
            )}
          </CardContent>
        </Card>
      </Box>
    );
  }

  // Tenant selected or TA user — show tenant dashboard
  return (
    <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
      <Card sx={{ maxWidth: 520, width: '100%' }}>
        <CardContent sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="h5" gutterBottom>
            Welcome, {roleName}
          </Typography>
          {isTenantSelected && (
            <Box sx={{ mt: 1, mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Managing tenant:
              </Typography>
              <Typography variant="h6" color="primary" sx={{ mt: 0.5 }}>
                {selectedTenantName || selectedTenantId}
              </Typography>
            </Box>
          )}
          <Typography variant="body2" color="text.secondary">
            Use the sidebar navigation to manage users, groups, brandings, 
            and service providers for this tenant.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SelectTenantPrompt;