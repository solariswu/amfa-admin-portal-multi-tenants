import { AppBar, TitlePortal, UserMenu, Logout, usePermissions } from "react-admin";
import { Box, Chip, Badge, Tooltip, Link as MuiLink } from "@mui/material";
import AccountCircle from "@mui/icons-material/AccountCircle";
import DomainIcon from "@mui/icons-material/Domain";
import { useTenantContext } from "./contexts/TenantContext";

/**
 * Role badge configuration
 * Maps role types to short labels, colors, and full names
 */
const ROLE_CONFIG = {
  SA:  { label: 'SA',  color: 'error',   fullName: 'Super Admin' },
  SPA: { label: 'SPA', color: 'primary', fullName: 'Service Provider Admin' },
  TA:  { label: 'TA',  color: 'success', fullName: 'Tenant Admin' },
};

/**
 * Get role config from permissions
 */
const getRoleConfig = (permissions) => {
  if (permissions?.isSA) return ROLE_CONFIG.SA;
  if (permissions?.isSPA) return ROLE_CONFIG.SPA;
  if (permissions?.isTA) return ROLE_CONFIG.TA;
  return null;
};

/**
 * Custom UserMenu with role badge on the user icon.
 * Shows a small "SA" / "SPA" / "TA" badge in the upper-right corner of the icon.
 */
const RoleBadgeUserMenu = () => {
  const { permissions } = usePermissions();
  const roleConfig = getRoleConfig(permissions);

  const badgedIcon = roleConfig ? (
    <Tooltip title={roleConfig.fullName} arrow>
      <Badge
        badgeContent={roleConfig.label}
        color={roleConfig.color}
        overlap="circular"
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{
          '& .MuiBadge-badge': {
            fontSize: '0.55rem',
            minWidth: 20,
            height: 16,
            padding: '0 4px',
            fontWeight: 'bold',
          },
        }}
      >
        <AccountCircle />
      </Badge>
    </Tooltip>
  ) : (
    <AccountCircle />
  );

  return (
    <UserMenu icon={badgedIcon}>
      <Logout />
    </UserMenu>
  );
};

/**
 * Custom toolbar with just the Support link and loading indicator area.
 */
const AppBarToolbar = () => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <MuiLink
      href="https://www.apersona.com/contact-us"
      underline="none"
      color="inherit"
      target="_blank"
      rel="noreferrer"
      sx={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }}
    >
      Support
    </MuiLink>
  </Box>
);

/**
 * AmfaAppBar
 * 
 * Layout: [☰ hamburger] [Page Title...] [logo + tenant chip (centered)] [Support] [👤 User with role badge]
 */
export const AmfaAppBar = () => {
  const { selectedTenantId, selectedTenantName, isTenantSelected } = useTenantContext();

  const tenantLabel = selectedTenantName || selectedTenantId || null;

  return (
    <AppBar
      color="secondary"
      toolbar={<AppBarToolbar />}
      userMenu={<RoleBadgeUserMenu />}
    >
      <TitlePortal />
      <Box
        sx={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          pointerEvents: 'none',
        }}
      >
        <img
          src="/apersona-logo2.png"
          alt="logo"
          height="36"
          style={{ marginTop: 4 }}
        />
        {isTenantSelected && tenantLabel && (
          <Chip
            icon={<DomainIcon sx={{ fontSize: 14 }} />}
            label={tenantLabel}
            size="small"
            sx={{
              bgcolor: 'rgba(255,255,255,0.15)',
              color: 'white',
              '& .MuiChip-icon': { color: 'rgba(255,255,255,0.7)' },
              fontSize: '0.7rem',
              height: 22,
              maxWidth: 200,
            }}
          />
        )}
      </Box>
    </AppBar>
  );
};