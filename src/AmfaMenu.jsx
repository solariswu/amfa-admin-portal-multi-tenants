import { Menu, usePermissions, useSidebarState } from 'react-admin';
import { Box, Divider, Typography } from '@mui/material';
import DomainIcon from '@mui/icons-material/Domain';
import { TenantSelector } from './Component/TenantSelector';
import { useTenantContext } from './contexts/TenantContext';

/**
 * Custom Menu component with role-based visibility and tenant context.
 * 
 * Layout:
 * ┌──────────────────────┐
 * │ Global Section       │
 * │  - IT Svc Orgs (SA)  │
 * │  - Tenants (SA/SPA)  │
 * │  - Admins (all roles)│
 * ├──────────────────────┤
 * │ Tenant Selector      │
 * │  [dropdown / label]  │
 * ├──────────────────────┤
 * │ Tenant Management    │
 * │  (visible when       │
 * │   tenant selected)   │
 * │  - Users             │
 * │  - User Import       │
 * │  - User Groups       │
 * │  - Branding          │
 * │  - Service Providers │
 * └──────────────────────┘
 */
export const AmfaMenu = () => {
  const { permissions } = usePermissions();
  const { isTenantSelected } = useTenantContext();
  const [sidebarOpen] = useSidebarState();

  const isSAOrSPA = permissions?.isSA || permissions?.isSPA;
  const isSA = permissions?.isSA;

  return (
    <Menu>
      {/* === Global Section (SA/SPA only) === */}
      {isSA && <Menu.ResourceItem name="organizations" />}
      {isSAOrSPA && <Menu.ResourceItem name="tenants" />}
      <Menu.ResourceItem name="admins" />

      {/* === Tenant Selector (hidden when sidebar collapsed) === */}
      {sidebarOpen && (
        <>
          <Divider sx={{ my: 1 }} />
          <TenantSelector />
        </>
      )}

      {/* === Tenant-Scoped Management Section === */}
      {isTenantSelected ? (
        <>
          {sidebarOpen && (
            <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ fontSize: '0.65rem', letterSpacing: '0.08em' }}
              >
                Tenant Management
              </Typography>
            </Box>
          )}
          <Menu.ResourceItem name="users" />
          <Menu.ResourceItem name="importusers" />
          <Menu.ResourceItem name="groups" />
          <Menu.ResourceItem name="appclients" />
          {!isSAOrSPA && <Menu.ResourceItem name="brandings" />}
          {!isSAOrSPA && <Menu.ResourceItem name="settings" />}
          {!isSAOrSPA && <Menu.ResourceItem name="smtp" />}
        </>
      ) : (
        sidebarOpen && (
          <Box sx={{ px: 2, py: 2 }}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                py: 2,
                px: 1,
                bgcolor: 'action.hover',
                borderRadius: 1,
              }}
            >
              <DomainIcon sx={{ fontSize: 32, color: 'text.disabled', mb: 1 }} />
              <Typography variant="caption" color="text.secondary">
                Select a tenant above to manage users, groups, brandings and service providers.
              </Typography>
            </Box>
          </Box>
        )
      )}
    </Menu>
  );
};