import { useState, useEffect, useCallback } from "react";
import {
  Container,
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  Divider,
  CircularProgress,
  Alert,
  Chip,
} from "@mui/material";
import {
  Form,
  TextInput,
  BooleanInput,
  NumberInput,
  PasswordInput,
  SaveButton,
  useNotify,
  CheckboxGroupInput,
  FormDataConsumer,
} from "react-admin";
import { ColorInput } from "react-admin-color-picker";

import awsmobile from "../aws-export";
import { getApiHeaders } from "../utils/apiHeaders";
import { useTenantContext } from "../contexts/TenantContext";

const apiUrl = awsmobile.aws_backend_api_url;

const OTP_METHOD_CHOICES = [
  { id: "e", name: "Email (e)" },
  { id: "ae", name: "Alt-Email (ae)" },
  { id: "s", name: "SMS (s)" },
  { id: "v", name: "Voice (v)" },
  { id: "t", name: "Mobile Token (t)" },
];

export const SettingsEdit = () => {
  const notify = useNotify();
  const { selectedTenantId, selectedTenantName } = useTenantContext();
  const [settingsData, setSettingsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const tenantId = selectedTenantId;

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
      if (json.type === "exception" || json.type === "Error") {
        throw new Error(json.message || "Failed to fetch settings");
      }
      setSettingsData(json.data);
    } catch (err) {
      console.error("Error fetching settings:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async (values) => {
    if (!tenantId) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/settings/${tenantId}`, {
        method: "PUT",
        body: JSON.stringify({ data: values }),
        headers: getApiHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to save settings: ${res.status}`);
      const json = await res.json();
      if (json.type === "exception" || json.type === "Error") {
        throw new Error(json.message || "Failed to save settings");
      }
      notify("Settings updated successfully", { type: "success" });
      await fetchSettings();
    } catch (err) {
      console.error("Error saving settings:", err);
      notify(`Error saving settings: ${err.message}`, { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (!tenantId) {
    return (
      <Container sx={{ padding: "15px", mt: 4 }}>
        <Alert severity="info">Please select a tenant to manage settings.</Alert>
      </Container>
    );
  }

  if (loading) {
    return (
      <Container sx={{ padding: "15px" }}>
        <Box sx={{ margin: 8, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <CircularProgress size={36} thickness={2} />
          <Typography sx={{ mt: 2 }} color="text.secondary">Loading tenant settings...</Typography>
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container sx={{ padding: "15px", mt: 4 }}>
        <Alert severity="error">Error loading settings: {error}</Alert>
      </Container>
    );
  }

  return (
    <Container sx={{ padding: "15px", mt: 2, mb: 6 }}>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Tenant Settings</Typography>
        <Chip label={`Tenant: ${selectedTenantName || tenantId}`} color="primary" variant="outlined" sx={{ mt: 1 }} />
      </Box>

      <Form defaultValues={settingsData || {}} onSubmit={handleSave} mode="onBlur" reValidateMode="onBlur">
        <Grid container spacing={3}>

          {/* ===== LEFT COLUMN ===== */}
          <Grid item xs={12} md={6}>
            {/* Authentication Settings */}
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography gutterBottom variant="h6" component="div" color="primary">
                  Authentication Settings
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <BooleanInput source="enable_password_reset" label="Enable Password Reset" helperText="Allow users to reset their password" />
                <BooleanInput source="enable_self_service" label="Enable Self Service" helperText="Allow users to manage their own profiles" />
                <BooleanInput source="enable_self_service_remove_buttons" label="Enable Self Service Remove Buttons" helperText="Show remove buttons in self service portal" />
                <BooleanInput source="enable_user_registration" label="Enable User Registration" helperText="Allow new users to register" />
                <BooleanInput source="enable_have_i_been_pwned" label="Enable Have I Been Pwned Check" helperText="Check passwords against known breach databases" />

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" gutterBottom>OTP Methods</Typography>
                <CheckboxGroupInput source="master_additional_otp_methods" label="" choices={OTP_METHOD_CHOICES} helperText="Email (e) is always available for password reset" />

                <Divider sx={{ my: 2 }} />

                <TextInput source="user_registration_default_group" label="Default User Group" helperText="Default group for new user registrations" fullWidth />
                <BooleanInput source="update_profile_force_mobile_token_first_if_registered" label="Force Mobile Token First" helperText="Require mobile token as first factor for profile updates" />
              </CardContent>
            </Card>

            {/* Login Service Branding */}
            <Card>
              <CardContent>
                <Typography gutterBottom variant="h6" component="div" color="primary">
                  Login Service Branding
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Branding for the AMFA login/authentication page.
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <TextInput source="service_name" label="Service Name" helperText="Display name on login page and emails" fullWidth />
                <TextInput source="mobile_token_svc_name" label="Mobile Token Service Name" helperText="Name in the mobile authenticator app" fullWidth />

                <Box sx={{ display: "flex", mt: 1 }}>
                  <ColorInput source="brand_base_color" label="Brand Base Color" fullWidth picker="Sketch" />
                  <FormDataConsumer>
                    {({ formData }) => (
                      <Box sx={{ bgcolor: formData?.brand_base_color, mt: 5, ml: 1, width: "1.5rem", height: "1.5rem", border: 1, borderRadius: 0.5 }} />
                    )}
                  </FormDataConsumer>
                </Box>

                <Box sx={{ mt: 1 }}>
                  <TextInput source="logo_url" label="Logo URL" helperText="Login page logo (250×50)" fullWidth />
                  <TextInput source="email_logo_url" label="Email Logo URL" helperText="Email notification logo (250×50)" fullWidth />
                  <TextInput source="favicon_url" label="Favicon URL" helperText="Browser tab icon (16×16)" fullWidth />
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* ===== RIGHT COLUMN ===== */}
          <Grid item xs={12} md={6}>
            {/* Password Policy */}
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography gutterBottom variant="h6" component="div" color="primary">
                  Password Policy
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <BooleanInput source="enable_password_expire" label="Enable Password Expiration" helperText="Force users to change password periodically" />
                <NumberInput source="passwords_expire_days" label="Password Expiry (days)" helperText="Number of days before password expires" min={1} max={365} />
                <BooleanInput source="enable_prevent_password_reuse" label="Prevent Password Reuse" helperText="Prevent users from reusing previous passwords" />
                <NumberInput source="prevent_password_reuse_count" label="Password Reuse Count" helperText="Number of previous passwords to remember" min={1} max={24} />
                <BooleanInput source="enable_auto_pwd_reset_on_threat" label="Auto Reset on Threat" helperText="Automatically reset password when threat is detected" />
              </CardContent>
            </Card>

            {/* Google reCAPTCHA */}
            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography gutterBottom variant="h6" component="div" color="primary">
                  Google reCAPTCHA
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <BooleanInput source="enable_google_recaptcha" label="Enable Google reCAPTCHA" helperText="Show reCAPTCHA on login page" />
                <TextInput source="recaptcha_key" label="reCAPTCHA Site Key" helperText="Google reCAPTCHA v2 site key (public)" fullWidth />
                <PasswordInput source="recaptcha_secret" label="reCAPTCHA Secret Key" helperText="Google reCAPTCHA v2 secret key" fullWidth />
              </CardContent>
            </Card>

            {/* Legal URLs */}
            <Card>
              <CardContent>
                <Typography gutterBottom variant="h6" component="div" color="primary">
                  Legal URLs
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Displayed on the AMFA login page. For End User Portal footer URLs, use the Branding page.
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <TextInput source="terms_of_service" label="Terms of Service URL" helperText="URL shown on login page" fullWidth />
                <TextInput source="privacy_policy" label="Privacy Policy URL" helperText="URL shown on login page" fullWidth />
              </CardContent>
            </Card>
          </Grid>

          {/* ===== SAVE BUTTON ===== */}
          <Grid item xs={12}>
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
              <SaveButton label={saving ? "Saving..." : "Update Settings"} disabled={saving} />
            </Box>
          </Grid>
        </Grid>
      </Form>
    </Container>
  );
};
