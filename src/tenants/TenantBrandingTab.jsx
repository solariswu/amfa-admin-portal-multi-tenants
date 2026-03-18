import { useState, useEffect, useCallback } from 'react';
import { useRecordContext } from 'react-admin';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Divider,
  Grid,
  CircularProgress,
  Alert,
  Button,
  Link as MuiLink,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import { useNavigate } from 'react-router-dom';
import awsmobile from '../aws-export';
import { getApiHeaders } from '../utils/apiHeaders';

const apiUrl = awsmobile.aws_backend_api_url;

/**
 * Renders a color swatch with label and hex value
 */
const ColorSwatchField = ({ value, label }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    {value ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, fontFamily: 'monospace' }}>
          {value}
        </Typography>
        <Box
          sx={{
            width: 24,
            height: 24,
            bgcolor: value,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 0.5,
            flexShrink: 0,
          }}
        />
      </Box>
    ) : (
      <Typography variant="body2" color="text.disabled">—</Typography>
    )}
  </Box>
);

/**
 * Renders a URL field with optional image preview thumbnail
 */
const ImageUrlField = ({ value, label, previewSize = { width: 120, height: 24 } }) => {
  const [imgError, setImgError] = useState(false);

  return (
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        {value ? (
          <MuiLink
            href={value}
            target="_blank"
            rel="noreferrer"
            variant="body2"
            sx={{
              maxWidth: '60%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
              textAlign: 'right',
            }}
          >
            {value}
          </MuiLink>
        ) : (
          <Typography variant="body2" color="text.disabled">—</Typography>
        )}
      </Box>
      {value && (
        <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
          {!imgError ? (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 0.5,
                bgcolor: 'grey.50',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={value}
                alt={label}
                style={{
                  maxWidth: previewSize.width,
                  maxHeight: previewSize.height,
                  objectFit: 'contain',
                }}
                onError={() => setImgError(true)}
              />
            </Box>
          ) : (
            <Box
              sx={{
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 1,
                p: 0.5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
              }}
            >
              <BrokenImageIcon fontSize="small" color="disabled" />
              <Typography variant="caption" color="text.disabled">Preview unavailable</Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

/**
 * Renders a simple text value with label
 */
const TextFieldRow = ({ value, label, isUrl = false }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    {isUrl && value ? (
      <MuiLink href={value} target="_blank" rel="noreferrer" variant="body2">
        {value}
      </MuiLink>
    ) : (
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {value ?? '—'}
      </Typography>
    )}
  </Box>
);

/**
 * TenantBrandingTab - Read-only view of tenant branding configuration.
 * Fetches:
 * - Login Service branding from GET /settings/{tenantId} (BRANDING_FIELDS)
 * - End User Portal branding from GET /brandings/{tenantId}_spportal
 */
export const TenantBrandingTab = () => {
  const record = useRecordContext();
  const navigate = useNavigate();
  const [loginBranding, setLoginBranding] = useState(null);
  const [portalBranding, setPortalBranding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const tenantId = record?.id;

  const fetchBranding = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, brandingRes] = await Promise.all([
        fetch(`${apiUrl}/settings/${tenantId}`, { headers: getApiHeaders() }),
        fetch(`${apiUrl}/brandings/${tenantId}_spportal`, { headers: getApiHeaders() }),
      ]);

      // Parse Login Service branding from settings
      if (settingsRes.ok) {
        const settingsJson = await settingsRes.json();
        if (settingsJson.data) {
          setLoginBranding({
            service_name: settingsJson.data.service_name,
            mobile_token_svc_name: settingsJson.data.mobile_token_svc_name,
            brand_base_color: settingsJson.data.brand_base_color,
            logo_url: settingsJson.data.logo_url,
            email_logo_url: settingsJson.data.email_logo_url,
            favicon_url: settingsJson.data.favicon_url,
          });
        }
      }

      // Parse End User Portal branding
      if (brandingRes.ok) {
        const brandingJson = await brandingRes.json();
        if (brandingJson.data) {
          setPortalBranding(brandingJson.data);
        }
      }
    } catch (err) {
      console.error('Error fetching branding:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  if (!tenantId) return null;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6 }}>
        <CircularProgress size={36} thickness={2} />
        <Typography sx={{ mt: 2 }} color="text.secondary">Loading branding...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ py: 3 }}>
        <Alert severity="error">Error loading branding: {error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ pt: 1 }}>
      {/* Edit Button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<EditIcon />}
          onClick={() => navigate('/brandings')}
        >
          Edit Branding
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* ===== Login Service Branding ===== */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" color="primary" gutterBottom>
                Login Service Branding
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Branding for the AMFA login/authentication page.
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {loginBranding ? (
                <>
                  <TextFieldRow value={loginBranding.service_name} label="Service Name" />
                  <Divider sx={{ my: 1 }} />
                  <TextFieldRow value={loginBranding.mobile_token_svc_name} label="Mobile Token Service Name" />
                  <Divider sx={{ my: 1 }} />
                  <ColorSwatchField value={loginBranding.brand_base_color} label="Brand Base Color" />
                  <Divider sx={{ my: 1 }} />
                  <ImageUrlField
                    value={loginBranding.logo_url}
                    label="Logo"
                    previewSize={{ width: 200, height: 40 }}
                  />
                  <Divider sx={{ my: 1 }} />
                  <ImageUrlField
                    value={loginBranding.email_logo_url}
                    label="Email Logo"
                    previewSize={{ width: 200, height: 40 }}
                  />
                  <Divider sx={{ my: 1 }} />
                  <ImageUrlField
                    value={loginBranding.favicon_url}
                    label="Favicon"
                    previewSize={{ width: 32, height: 32 }}
                  />
                </>
              ) : (
                <Alert severity="info" variant="outlined">
                  No login service branding configured.
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* ===== End User Portal Branding ===== */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" color="primary" gutterBottom>
                End User Portal Branding
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Branding for the self-service end user portal.
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {portalBranding ? (
                <>
                  {/* Text Messages */}
                  <TextFieldRow value={portalBranding.app_title_msg} label="Title Message" />
                  <Divider sx={{ my: 1 }} />
                  <TextFieldRow value={portalBranding.portal_title_msg} label="Portal Title" />
                  <Divider sx={{ my: 1 }} />
                  <TextFieldRow value={portalBranding.portal_description_msg} label="Portal Description" />

                  <Divider sx={{ my: 2 }} />

                  {/* Colors */}
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Colors
                  </Typography>
                  <ColorSwatchField value={portalBranding.login_page_center_color} label="Login Page Center" />
                  <ColorSwatchField value={portalBranding.login_page_outter_color} label="Login Page Outer" />
                  <ColorSwatchField value={portalBranding.app_bar_start_color} label="App Bar Start" />
                  <ColorSwatchField value={portalBranding.app_bar_end_color} label="App Bar End" />
                  <ColorSwatchField value={portalBranding.app_title_icon_color} label="Title Icon" />

                  <Divider sx={{ my: 2 }} />

                  {/* Logos */}
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Logos
                  </Typography>
                  <ImageUrlField
                    value={portalBranding.app_login_logo_url}
                    label="Login Logo"
                    previewSize={{ width: 200, height: 40 }}
                  />
                  <Divider sx={{ my: 1 }} />
                  <ImageUrlField
                    value={portalBranding.app_bar_logo_url}
                    label="App Bar Logo"
                    previewSize={{ width: 200, height: 40 }}
                  />
                  <Divider sx={{ my: 1 }} />
                  <ImageUrlField
                    value={portalBranding.fav_icon_url}
                    label="Favicon"
                    previewSize={{ width: 32, height: 32 }}
                  />

                  <Divider sx={{ my: 2 }} />

                  {/* Legal URLs */}
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Legal URLs
                  </Typography>
                  <TextFieldRow value={portalBranding.app_terms_url} label="Terms of Service" isUrl />
                  <Divider sx={{ my: 1 }} />
                  <TextFieldRow value={portalBranding.app_privacy_url} label="Privacy Policy" isUrl />
                </>
              ) : (
                <Alert severity="info" variant="outlined">
                  No end user portal branding configured.
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default TenantBrandingTab;
