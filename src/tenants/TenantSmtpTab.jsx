import { useState, useEffect, useCallback } from 'react';
import { useRecordContext, useNotify } from 'react-admin';
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
  TextField,
  Switch,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Chip,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import SendIcon from '@mui/icons-material/Send';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import awsmobile from '../aws-export';
import { getApiHeaders } from '../utils/apiHeaders';

const apiUrl = awsmobile.aws_backend_api_url;

/**
 * Build API headers with explicit tenant ID override.
 * This ensures we target the tenant being viewed, not the one in sessionStorage.
 */
const getHeadersForTenant = (tenantId) => {
  const headers = getApiHeaders();
  if (tenantId) {
    headers['X-Tenant-Id'] = tenantId;
  }
  return headers;
};

/**
 * Read-only display row
 */
const TextFieldRow = ({ value, label }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 500 }}>
      {value ?? '—'}
    </Typography>
  </Box>
);

/**
 * Boolean display chip
 */
const BooleanField = ({ value, label }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Chip
      icon={value ? <CheckCircleIcon /> : <CancelIcon />}
      label={value ? 'Yes' : 'No'}
      color={value ? 'success' : 'default'}
      size="small"
      variant="outlined"
      sx={{ fontWeight: 500 }}
    />
  </Box>
);

/**
 * TenantSmtpTab - SMTP configuration view and inline edit with test functionality.
 *
 * Data flow:
 * - READ: GET /smtpconfig (returns current SMTP settings from Secrets Manager)
 * - SAVE: PUT /smtpconfig (persists SMTP settings to Secrets Manager)
 * - TEST: POST /smtpconfig (sends a test email using the provided settings)
 */
export const TenantSmtpTab = () => {
  const record = useRecordContext();
  const notify = useNotify();
  const tenantId = record?.id;

  // State
  const [smtpData, setSmtpData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Form fields
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [testEmail, setTestEmail] = useState('');

  /**
   * Fetch SMTP config from the backend
   */
  const fetchSmtp = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/smtpconfig`, {
        headers: getHeadersForTenant(tenantId),
      });
      if (!res.ok) throw new Error(`Failed to fetch SMTP config: ${res.status}`);
      const json = await res.json();
      if (json.type === 'exception' || json.type === 'Error') {
        throw new Error(json.message || 'Failed to fetch SMTP config');
      }
      const data = json.data || {};
      setSmtpData(data);
      // Initialize form fields
      setHost(data.host || '');
      setPort(data.port || '');
      setSecure(data.secure === true || data.secure === 'true');
      setUser(data.user || '');
      setPass(data.pass || '');
    } catch (err) {
      console.error('Error fetching SMTP config:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchSmtp();
  }, [fetchSmtp]);

  /**
   * Save SMTP config
   */
  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { host, port, secure, user, pass };
      const res = await fetch(`${apiUrl}/smtpconfig`, {
        method: 'PUT',
        body: JSON.stringify({ data: payload }),
        headers: getHeadersForTenant(tenantId),
      });
      const json = await res.json();
      if (!res.ok || json.type === 'exception' || json.type === 'Error') {
        throw new Error(json.message || json.data || 'Failed to save SMTP config');
      }
      notify('SMTP configuration saved successfully', { type: 'success' });
      setSmtpData(payload);
      setEditing(false);
    } catch (err) {
      console.error('Error saving SMTP config:', err);
      notify(`Error saving SMTP config: ${err.message}`, { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Test SMTP by sending a test email
   */
  const handleTest = async () => {
    if (!testEmail) {
      notify('Please enter a test email address', { type: 'warning' });
      return;
    }
    setTesting(true);
    try {
      const payload = { host, port, secure, user, pass, toUser: testEmail };
      const res = await fetch(`${apiUrl}/smtpconfig`, {
        method: 'POST',
        body: JSON.stringify({ data: payload }),
        headers: getHeadersForTenant(tenantId),
      });
      const json = await res.json();
      if (!res.ok || json.type === 'exception' || json.type === 'Error') {
        throw new Error(json.data || json.message || 'Test email failed');
      }
      notify('SMTP test email sent successfully!', { type: 'success' });
    } catch (err) {
      console.error('SMTP test error:', err);
      notify(`SMTP test email error: ${err.message}`, { type: 'error' });
    } finally {
      setTesting(false);
    }
  };

  /**
   * Cancel editing and revert form fields
   */
  const handleCancel = () => {
    setHost(smtpData?.host || '');
    setPort(smtpData?.port || '');
    setSecure(smtpData?.secure === true || smtpData?.secure === 'true');
    setUser(smtpData?.user || '');
    setPass(smtpData?.pass || '');
    setTestEmail('');
    setEditing(false);
  };

  if (!tenantId) return null;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6 }}>
        <CircularProgress size={36} thickness={2} />
        <Typography sx={{ mt: 2 }} color="text.secondary">Loading SMTP configuration...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ py: 3 }}>
        <Alert severity="error">Error loading SMTP configuration: {error}</Alert>
      </Box>
    );
  }

  // ===== READ-ONLY VIEW =====
  if (!editing) {
    return (
      <Box sx={{ pt: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setEditing(true)}
          >
            Edit SMTP
          </Button>
        </Box>

        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" color="primary" gutterBottom>
                  SMTP Server Configuration
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Email delivery settings for this tenant.
                </Typography>
                <Divider sx={{ mb: 2 }} />

                {smtpData && (smtpData.host || smtpData.user) ? (
                  <>
                    <TextFieldRow value={smtpData.host} label="Host" />
                    <Divider sx={{ my: 1 }} />
                    <TextFieldRow value={smtpData.port} label="Port" />
                    <Divider sx={{ my: 1 }} />
                    <BooleanField value={smtpData.secure === true || smtpData.secure === 'true'} label="Secure (TLS)" />
                    <Divider sx={{ my: 1 }} />
                    <TextFieldRow value={smtpData.user} label="Username" />
                    <Divider sx={{ my: 1 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.75 }}>
                      <Typography variant="body2" color="text.secondary">Password</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {smtpData.pass ? '••••••••••••' : '—'}
                      </Typography>
                    </Box>
                  </>
                ) : (
                  <Alert severity="info" variant="outlined">
                    No SMTP configuration found for this tenant.
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>
    );
  }

  // ===== EDIT VIEW =====
  return (
    <Box sx={{ pt: 1 }}>
      <Grid container spacing={3}>
        {/* SMTP Settings Form */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" color="primary" gutterBottom>
                SMTP Server Configuration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Configure the SMTP server used for sending emails from this tenant.
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  label="SMTP Host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  size="small"
                  fullWidth
                  placeholder="e.g. smtp.gmail.com"
                />
                <TextField
                  label="Port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  size="small"
                  type="number"
                  sx={{ maxWidth: 200 }}
                  placeholder="e.g. 587"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={secure}
                      onChange={(e) => setSecure(e.target.checked)}
                      size="small"
                    />
                  }
                  label="Secure (TLS)"
                />
                <TextField
                  label="Username"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  size="small"
                  fullWidth
                  placeholder="SMTP username or email"
                />
                <TextField
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  size="small"
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowPassword(!showPassword)}
                          edge="end"
                          size="small"
                        >
                          {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>

              <Divider sx={{ my: 2 }} />

              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                <Button
                  variant="text"
                  size="small"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                  onClick={handleSave}
                  disabled={saving || !host || !user}
                >
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Test SMTP Card */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" color="primary" gutterBottom>
                Test SMTP
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Send a test email using the current SMTP settings to verify they work correctly.
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <TextField
                label="Test Email Address"
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                size="small"
                fullWidth
                placeholder="recipient@example.com"
                disabled={testing}
              />

              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  startIcon={testing ? <CircularProgress size={16} /> : <SendIcon />}
                  onClick={handleTest}
                  disabled={testing || !testEmail || !host || !user}
                >
                  {testing ? 'Sending...' : 'Send Test Email'}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default TenantSmtpTab;
