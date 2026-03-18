import { Container, Grid, Box, Typography } from "@mui/material";
import {
  Edit,
  FunctionField,
  Form,
  TextInput,
  TopToolbar,
  SaveButton,
  ListButton,
  FormDataConsumer,
} from "react-admin";

import { ColorInput } from "react-admin-color-picker";
import { validateUrl } from "../utils/validation";

export const AmfaBrandingEdit = () => {
  const EditActions = () => (
    <TopToolbar>
      <ListButton />
    </TopToolbar>
  );

  const MyForm = () => {
    return (
      <Container sx={{ mb: 2 }}>
        <Box
          sx={{
            mt: 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <FunctionField
            render={(record) => (
              <Box>
                <Typography variant="h4">
                  {record.tenant_name || record.name} - Login Service Portal Branding
                </Typography>
              </Box>
            )}
          />
        </Box>
        <div style={{ height: "2em" }} />

        <TextInput
          label="Service Name"
          source="service_name"
          required
          fullWidth
          helperText="Display name shown on the login page and emails"
        />
        <div style={{ height: "2em" }} />

        <TextInput
          label="Mobile Token Service Name"
          source="mobile_token_svc_name"
          required
          fullWidth
          helperText="Name shown in the mobile authenticator app"
        />
        <div style={{ height: "2em" }} />

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={6} lg={5}>
            <Box sx={{ display: "flex" }}>
              <ColorInput
                source="brand_base_color"
                label="Brand Base Color"
                fullWidth
                isRequired
                picker="Sketch"
              />
              <FormDataConsumer>
                {({ formData }) => (
                  <Box
                    sx={{
                      bgcolor: formData["brand_base_color"],
                      mt: 5,
                      ml: 1,
                      width: "1rem",
                      height: "1rem",
                      border: 1,
                    }}
                  />
                )}
              </FormDataConsumer>
            </Box>
          </Grid>
        </Grid>

        <div style={{ height: "2em" }} />
        <TextInput
          source="logo_url"
          label="Logo URL"
          required
          validate={validateUrl}
          fullWidth
          helperText="Logo displayed on the login page (size 250x50)"
        />
        <div style={{ height: "2em" }} />
        <TextInput
          source="email_logo_url"
          label="Email Logo URL"
          required
          validate={validateUrl}
          fullWidth
          helperText="Logo used in email notifications (size 250x50)"
        />
        <div style={{ height: "2em" }} />
        <TextInput
          source="favicon_url"
          label="Favicon URL"
          required
          validate={validateUrl}
          fullWidth
          helperText="Browser tab icon (size 16x16)"
        />

        <div style={{ height: "0.5em" }} />
        <Box sx={{ margin: "2em 0 5em 0" }}>
          <SaveButton label="Update" />
        </Box>
      </Container>
    );
  };

  return (
    <Edit
      mutationMode="pessimistic"
      redirect="list"
      actions={<EditActions />}
      emptyWhileLoading
    >
      <Form mode="onBlur" reValidateMode="onBlur">
        <MyForm />
      </Form>
    </Edit>
  );
};
