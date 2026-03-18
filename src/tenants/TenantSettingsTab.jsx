import { useState, useEffect, useCallback } from 'react';
import { useRecordContext } from 'react-admin';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Divider,
  Grid,
  Chip,
  CircularProgress,
  Alert,
  Button,
  Link as MuiLink,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import EditIcon from '@mui/icons-material/Edit';
import { useNavigate } from 'react-router-dom';
import awsmobile from '../aws-export';
import { getApiHeaders } from '../utils/apiHeaders';

const apiUrl = awsmobile.aws_backend_api_url;

const OTP_METHOD_LABELS = {
  e: 'Email',
  ae: 'Alt-Email',
  s: 'SMS',
  v: 'Voice',
  t: 'Mobile Token',
};

/**
 * Renders a boolean value as a colored chip with icon
 */
const BooleanField = ({ value, label }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Chip
      icon={value ? <CheckCircleIcon /> : <CancelIcon />}
      label={value ? 'Enabled' : 'Disabled'}
      color={value ? 'success' : 'default'}
      size="small"
      variant="outlined"
      sx={{ fontWeight: 500 }}
    />
  </Box>
);

/**
 * Renders a text value with label
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
 * Renders a number value with label
 */
const NumberFieldRow = ({ value, label, suffix = '' }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 500 }}>
      {value != null ? `${value}${suffix}` : '—'}
    </Typography>
  </Box>
);

/**
 * TenantSettingsTab - Read-only view of tenant settings.
 * Fetches directly from the settings API using the tenant ID from the record.
 */
export const TenantSettingsTab = () => {
  const record = useRecordContext();
  const navigate = useNavigate();
  const [settingsData, setSettingsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const tenantId = record?.id;

  const fetchSettings = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/settings/${tenantId}`, {
        headers: getApiHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to fetch settings: ${res.status}`);
      const json = await res.json();
      if (json.type === 'exception' || json.type === 'Error') {
        throw new Error(json.message || 'Failed to fetch settings');
      }
      setSettingsData(json.data);
    } catch (err) {
      console.error('Error fetching settings:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  if (!tenantId) return null;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6 }}>
        <CircularProgress size={36} thickness={2} />
        <Typography sx={{ mt: 2 }} color="text.secondary">Loading settings...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ py: 3 }}>
        <Alert severity="error">Error loading settings: {error}</Alert>
      </Box>
    );
  }

  if (!settingsData) {
    return (
      <Box sx={{ py: 3 }}>
        <Alert severity="info">No settings configured for this tenant.</Alert>
      </Box>
    );
  }

  const otpMethods = settingsData.master_additional_otp_methods || [];
  const otpLabels = Array.isArray(otpMethods)
    ? otpMethods.map(m => OTP_METHOD_LABELS[m] || m)
    : [];

  return (
    <Box sx={{ pt: 1 }}>
      {/* Edit Button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<EditIcon />}
          onClick={() => navigate('/settings')}
        >
          Edit Settings
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* ===== LEFT COLUMN ===== */}
        <Grid item xs={12} md={6}>
          {/* Authentication Settings */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" color="primary" gutterBottom>
                Authentication Settings
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <BooleanField value={settingsData.enable_password_reset} label="Password Reset" />
              <BooleanField value={settingsData.enable_self_service} label="Self Service" />
              <BooleanField value={settingsData.enable_self_service_remove_buttons} label="Self Service Remove Buttons" />
              <BooleanField value={settingsData.enable_user_registration} label="User Registration" />
              <BooleanField value={settingsData.enable_have_i_been_pwned} label="Have I Been Pwned Check" />

              <Divider sx={{ my: 1.5 }} />

              <Box sx={{ py: 0.75 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>OTP Methods</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {otpLabels.length > 0 ? (
                    otpLabels.map((label) => (
                      <Chip key={label} label={label} size="small" color="info" variant="outlined" />
                    ))
                  ) : (
                    <Typography variant="body2" color="text.disabled">None configured</Typography>
                  )}
                </Box>
              </Box>

              <Divider sx={{ my: 1.5 }} />

              <TextFieldRow value={settingsData.user_registration_default_group} label="Default User Group" />
              <BooleanField value={settingsData.update_profile_force_mobile_token_first_if_registered} label="Force Mobile Token First" />
            </CardContent>
          </Card>

          {/* Legal URLs */}
          <Card>
            <CardContent>
              <Typography variant="h6" color="primary" gutterBottom>
                Legal URLs
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Displayed on the AMFA login page.
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <TextFieldRow value={settingsData.terms_of_service} label="Terms of Service" isUrl />
              <Divider sx={{ my: 1 }} />
              <TextFieldRow value={settingsData.privacy_policy} label="Privacy Policy" isUrl />
            </CardContent>
          </Card>
        </Grid>

        {/* ===== RIGHT COLUMN ===== */}
        <Grid item xs={12} md={6}>
          {/* Password Policy */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" color="primary" gutterBottom>
                Password Policy
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <BooleanField value={settingsData.enable_password_expire} label="Password Expiration" />
              <NumberFieldRow value={settingsData.passwords_expire_days} label="Expiry Period" suffix=" days" />
              <Divider sx={{ my: 1 }} />
              <BooleanField value={settingsData.enable_prevent_password_reuse} label="Prevent Password Reuse" />
              <NumberFieldRow value={settingsData.prevent_password_reuse_count} label="Reuse History Count" />
              <Divider sx={{ my: 1 }} />
              <BooleanField value={settingsData.enable_auto_pwd_reset_on_threat} label="Auto Reset on Threat" />
            </CardContent>
          </Card>

          {/* Google reCAPTCHA */}
          <Card>
            <CardContent>
              <Typography variant="h6" color="primary" gutterBottom>
                Google reCAPTCHA
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <BooleanField value={settingsData.enable_google_recaptcha} label="reCAPTCHA" />
              <Divider sx={{ my: 1 }} />
              <TextFieldRow value={settingsData.recaptcha_key} label="Site Key" />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
                <Typography variant="body2" color="text.secondary">Secret Key</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {settingsData.recaptcha_secret ? '••••••••••••' : '—'}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default TenantSettingsTab;
