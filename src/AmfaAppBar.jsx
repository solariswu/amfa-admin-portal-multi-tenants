import { AppBar, usePermissions } from "react-admin";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import Chip from "@mui/material/Chip";
import DomainIcon from "@mui/icons-material/Domain";
import { useTenantContext } from "./contexts/TenantContext";

export const AmfaAppBar = (props) => {
  const { selectedTenantId, selectedTenantName, isTenantSelected } = useTenantContext();
  const { permissions } = usePermissions();

  // Build the tenant display label
  const tenantLabel = selectedTenantName
    ? `${selectedTenantName}`
    : selectedTenantId || null;

  // Build the role badge label
  const roleLabel = permissions?.isSA
    ? 'Super Admin'
    : permissions?.isSPA
      ? 'Service Provider Admin'
      : permissions?.isTA
        ? 'Tenant Admin'
        : null;

  return (
    <AppBar color="secondary">
      <Typography
        variant="h6"
        color="inherit"
        id="react-admin-title"
        sx={{
          flex: 1,
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          overflow: "hidden",
          marginLeft: -10,
        }}
      />
      <div style={{ flex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
        <img
          src="/apersona-logo2.png"
          alt="logo"
          height="36"
          style={{ marginTop: "6px" }}
        />
        {isTenantSelected && (
          <Chip
            icon={<DomainIcon sx={{ fontSize: 16 }} />}
            label={tenantLabel}
            size="small"
            sx={{
              bgcolor: 'rgba(255,255,255,0.15)',
              color: 'white',
              '& .MuiChip-icon': { color: 'rgba(255,255,255,0.7)' },
              fontSize: '0.75rem',
              height: 24,
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
        {roleLabel && (
          <Typography
            variant="caption"
            sx={{
              color: 'rgba(255,255,255,0.7)',
              fontSize: '0.7rem',
              whiteSpace: 'nowrap',
            }}
          >
            {roleLabel}
          </Typography>
        )}
        <Link href="https://www.apersona.com/contact-us" underline="none" color={"white"} target="_blank" rel="noreferrer">
          Support
        </Link>
      </div>
    </AppBar>
  );
};