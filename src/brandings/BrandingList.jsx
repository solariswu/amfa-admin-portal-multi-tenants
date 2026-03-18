import { useState, useEffect, useCallback } from "react";
import {
  Container,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Chip,
  Grid,
} from "@mui/material";
import {
  Form,
  TextInput,
  SaveButton,
  useNotify,
  FormDataConsumer,
} from "react-admin";
import { ColorInput } from "react-admin-color-picker";

import awsmobile from "../aws-export";
import { getApiHeaders } from "../utils/apiHeaders";
import { useTenantContext } from "../contexts/TenantContext";
import { validateUrl } from "../utils/validation";

const apiUrl = awsmobile.aws_backend_api_url;

/**
 * SP Portal Branding Edit - loads branding for the selected tenant directly.
 * No list view needed since each tenant has exactly one SP Portal branding.
 */
export const BrandingList = () => {
  const notify = useNotify();
  const { selectedTenantId, selectedTenantName } = useTenantContext();
  const [brandingData, setBrandingData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const tenantId = selectedTenantId;

  const fetchBranding = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/brandings/${tenantId}_spportal`, {
        headers: getApiHeaders(),
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch branding: ${res.status}`);
      }
      const json = await res.json();
      if (json.type === "exception" || json.type === "Error") {
        throw new Error(json.message || "Failed to fetch branding");
      }
      setBrandingData(json.data);
    } catch (err) {
      console.error("Error fetching branding:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  const handleSave = async (values) => {
    if (!tenantId) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/brandings/${tenantId}_spportal`, {
        method: "PUT",
        body: JSON.stringify({ data: values }),
        headers: getApiHeaders(),
      });
      if (!res.ok) {
        throw new Error(`Failed to save branding: ${res.status}`);
      }
      const json = await res.json();
      if (json.type === "exception" || json.type === "Error") {
        throw new Error(json.message || "Failed to save branding");
      }
      notify("Branding updated successfully", { type: "success" });
      await fetchBranding();
    } catch (err) {
      console.error("Error saving branding:", err);
      notify(`Error saving branding: ${err.message}`, { type: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (!tenantId) {
    return (
      <Container sx={{ padding: "15px", mt: 4 }}>
        <Alert severity="info">
          Please select a tenant to manage branding.
        </Alert>
      </Container>
    );
  }

  if (loading) {
    return (
      <Container sx={{ padding: "15px" }}>
        <Box sx={{ margin: 8, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <CircularProgress size={36} thickness={2} />
          <Typography sx={{ mt: 2 }} color="text.secondary">
            Loading branding...
          </Typography>
        </Box>
      </Container>
    );
  }

  if (error) {
    return (
      <Container sx={{ padding: "15px", mt: 4 }}>
        <Alert severity="error">Error loading branding: {error}</Alert>
      </Container>
    );
  }

  return (
    <Container sx={{ padding: "15px", mt: 2, mb: 6 }}>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">End User Portal Branding</Typography>
        <Chip
          label={`Tenant: ${selectedTenantName || tenantId}`}
          color="primary"
          variant="outlined"
          sx={{ mt: 1 }}
        />
      </Box>

      <Form
        defaultValues={brandingData || {}}
        onSubmit={handleSave}
        mode="onBlur"
        reValidateMode="onBlur"
      >
        <TextInput label="Title Message" source="app_title_msg" required fullWidth helperText={false} />
        <div style={{ height: "1.5em" }} />
        <TextInput label="Portal Title Message" source="portal_title_msg" fullWidth helperText={false} />
        <div style={{ height: "1.5em" }} />
        <TextInput label="Portal Description Message" source="portal_description_msg" fullWidth helperText={false} />

        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid item xs={12} sm={6} md={4}>
            <Box sx={{ display: "flex" }}>
              <ColorInput source="login_page_center_color" fullWidth isRequired picker="Sketch" />
              <FormDataConsumer>
                {({ formData }) => (
                  <Box sx={{ bgcolor: formData?.login_page_center_color, mt: 5, ml: 1, width: "1rem", height: "1rem", border: 1 }} />
                )}
              </FormDataConsumer>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Box sx={{ display: "flex" }}>
              <ColorInput source="login_page_outter_color" fullWidth isRequired picker="Sketch" />
              <FormDataConsumer>
                {({ formData }) => (
                  <Box sx={{ bgcolor: formData?.login_page_outter_color, mt: 5, ml: 1, width: "1rem", height: "1rem", border: 1 }} />
                )}
              </FormDataConsumer>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Box sx={{ display: "flex" }}>
              <ColorInput source="app_bar_start_color" fullWidth isRequired picker="Sketch" />
              <FormDataConsumer>
                {({ formData }) => (
                  <Box sx={{ bgcolor: formData?.app_bar_start_color, mt: 5, ml: 1, width: "1rem", height: "1rem", border: 1 }} />
                )}
              </FormDataConsumer>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Box sx={{ display: "flex" }}>
              <ColorInput source="app_bar_end_color" fullWidth isRequired picker="Sketch" />
              <FormDataConsumer>
                {({ formData }) => (
                  <Box sx={{ bgcolor: formData?.app_bar_end_color, mt: 5, ml: 1, width: "1rem", height: "1rem", border: 1 }} />
                )}
              </FormDataConsumer>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6} md={4}>
            <Box sx={{ display: "flex" }}>
              <ColorInput source="app_title_icon_color" fullWidth isRequired picker="Sketch" />
              <FormDataConsumer>
                {({ formData }) => (
                  <Box sx={{ bgcolor: formData?.app_title_icon_color, mt: 5, ml: 1, width: "1rem", height: "1rem", border: 1 }} />
                )}
              </FormDataConsumer>
            </Box>
          </Grid>
        </Grid>

        <div style={{ height: "1.5em" }} />
        <TextInput source="app_login_logo_url" required validate={validateUrl} fullWidth helperText="size 250x50" />
        <div style={{ height: "1.5em" }} />
        <TextInput source="fav_icon_url" required validate={validateUrl} fullWidth helperText="size 16x16" />
        <div style={{ height: "1.5em" }} />
        <TextInput source="app_bar_logo_url" required validate={validateUrl} fullWidth helperText="size 250x50" />
        <div style={{ height: "1.5em" }} />
        <TextInput source="app_terms_url" required validate={validateUrl} fullWidth helperText={false} />
        <div style={{ height: "1.5em" }} />
        <TextInput source="app_privacy_url" required validate={validateUrl} fullWidth helperText={false} />

        <Box sx={{ margin: "2em 0 5em 0" }}>
          <SaveButton label={saving ? "Saving..." : "Update Branding"} disabled={saving} />
        </Box>
      </Form>
    </Container>
  );
};
