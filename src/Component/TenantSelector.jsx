import React, { useState, useEffect } from 'react';
import { usePermissions, useGetList } from 'react-admin';
import {
  Box,
  FormControl,
  Select,
  MenuItem,
  Typography,
  Chip,
  InputLabel,
  CircularProgress,
} from '@mui/material';
import DomainIcon from '@mui/icons-material/Domain';
import { useTenantContext } from '../contexts/TenantContext';

/**
 * TenantSelector component for the sidebar menu.
 * 
 * - SA: Shows dropdown of ALL tenants
 * - SPA: Shows dropdown of tenants belonging to their organization
 * - TA: Shows a static label with their assigned tenant name
 */
export const TenantSelector = () => {
  const { permissions, isLoading: permissionsLoading } = usePermissions();
  const { selectedTenantId, selectedTenantName, setSelectedTenant } = useTenantContext();

  const isTA = permissions?.isTA;
  const isSAOrSPA = permissions?.isSA || permissions?.isSPA;

  // Fetch tenants list for SA/SPA
  const { data: tenants, isLoading: tenantsLoading } = useGetList(
    'tenants',
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'name', order: 'ASC' },
    },
    { enabled: isSAOrSPA && !permissionsLoading }
  );

  // For TA: resolve tenant name from the tenants list or use the ID
  useEffect(() => {
    if (isTA && selectedTenantId && tenants) {
      const tenant = tenants.find(t => t.id === selectedTenantId);
      if (tenant && tenant.name) {
        setSelectedTenant(selectedTenantId, tenant.name);
      }
    }
  }, [isTA, selectedTenantId, tenants, setSelectedTenant]);

  if (permissionsLoading) return null;

  // TA users: show static tenant label
  if (isTA) {
    return (
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          Your Tenant
        </Typography>
        <Chip
          icon={<DomainIcon />}
          label={selectedTenantName || selectedTenantId || 'Loading...'}
          color="primary"
          variant="outlined"
          size="small"
          sx={{ maxWidth: '100%' }}
        />
      </Box>
    );
  }

  // SA/SPA users: show tenant dropdown
  if (isSAOrSPA) {
    const handleChange = (event) => {
      const tenantId = event.target.value;
      if (tenantId === '') {
        setSelectedTenant(null, null);
        return;
      }
      const tenant = tenants?.find(t => t.id === tenantId);
      setSelectedTenant(tenantId, tenant?.name || tenantId);
    };

    return (
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          Select Tenant
        </Typography>
        <FormControl fullWidth size="small">
          <Select
            value={selectedTenantId || ''}
            onChange={handleChange}
            sx={{ fontSize: '0.85rem' }}
            displayEmpty
            renderValue={(value) => {
              if (!value) {
                return <Typography variant="body2" color="text.disabled">— Select a tenant —</Typography>;
              }
              const tenant = tenants?.find(t => t.id === value);
              return <Typography variant="body2">{tenant?.name || value}</Typography>;
            }}
            endAdornment={tenantsLoading ? <CircularProgress size={16} sx={{ mr: 2 }} /> : null}
          >
            <MenuItem value="">
              <em>— None —</em>
            </MenuItem>
            {tenants?.map(tenant => (
              <MenuItem key={tenant.id} value={tenant.id}>
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="body2">{tenant.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {tenant.id}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    );
  }

  return null;
};

export default TenantSelector;