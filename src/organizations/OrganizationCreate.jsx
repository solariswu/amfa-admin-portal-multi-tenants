import React, { useState, useEffect } from 'react';
import {
  Create,
  SimpleForm,
  TextInput,
  required,
  useNotify,
  useRedirect,
} from 'react-admin';
import {
  Box,
  Typography,
  Avatar,
  Alert,
  CircularProgress,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import { canCreateOrganizations } from '../utils/roleUtils';

/**
 * Validation: Organization ID must be lowercase alphanumeric with dash/underscore
 */
const validateOrgId = (value) => {
  if (!value) {
    return 'IT Svc Org ID is required';
  }
  if (!/^[a-z0-9-_]{2,50}$/.test(value)) {
    return 'IT Svc Org ID must be lowercase alphanumeric, dash, or underscore (2-50 chars)';
  }
  return undefined;
};

/**
 * Validation: Organization name
 */
const validateOrgName = (value) => {
  if (!value) {
    return 'IT Svc Org name is required';
  }
  if (value.length < 2 || value.length > 100) {
    return 'IT Svc Org name must be 2-100 characters';
  }
  return undefined;
};

/**
 * OrganizationCreate Component
 * Form for creating new organizations (SA only)
 */
export const OrganizationCreate = () => {
  const notify = useNotify();
  const redirect = useRedirect();
  const [loading, setLoading] = useState(true);
  const [canCreate, setCanCreate] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    setCanCreate(canCreateOrganizations(token));
    setLoading(false);
  }, []);

  // Show loading while checking permissions
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="80vh">
        <CircularProgress />
      </Box>
    );
  }

  // Check permission: Only SA can create organizations
  if (!canCreate) {
    return (
      <Box p={3}>
        <Alert severity="error">
          <Typography variant="h6">Insufficient Permissions</Typography>
          <Typography variant="body2">
            Only Super Admins can create IT Svc Orgs.
          </Typography>
        </Alert>
      </Box>
    );
  }

  const onSuccess = (data) => {
    notify(`IT Svc Org "${data.name}" created successfully!`, {
      type: 'success',
    });
    redirect('show', 'organizations', data.id);
  };

  const onError = (error) => {
    notify(`Failed to create IT Svc Org: ${error.message}`, {
      type: 'error',
    });
  };

  return (
    <Create
      title="Create New IT Svc Org"
      redirect="show"
      mutationOptions={{ onSuccess, onError }}
    >
      <Box display="flex" flexDirection="column" alignItems="center" p={3}>
        <Avatar sx={{ m: 1, bgcolor: 'primary.main', width: 56, height: 56 }}>
          <BusinessIcon fontSize="large" />
        </Avatar>
        <Typography component="h1" variant="h4" mb={1}>
          Create New IT Svc Org
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          Create a new IT Svc Org to group tenants
        </Typography>

        <SimpleForm sx={{ maxWidth: 600, width: '100%' }}>
          <TextInput
            source="id"
            label="IT Svc Org ID"
            validate={[required(), validateOrgId]}
            helperText="Unique ID (e.g., 'acme', 'contoso'). Lowercase, alphanumeric, dash, or underscore only."
            fullWidth
            inputProps={{
              style: { textTransform: 'lowercase' },
            }}
          />

          <TextInput
            source="name"
            label="IT Svc Org Name"
            validate={[required(), validateOrgName]}
            helperText="Display name for the IT Svc Org (2-100 characters)"
            fullWidth
          />

          <TextInput
            source="description"
            label="Description"
            multiline
            rows={4}
            helperText="Optional description of the IT Svc Org"
            fullWidth
          />

          <Box mt={2}>
            <Alert severity="info">
              <Typography variant="body2">
                <strong>Note:</strong> IT Svc Org IDs cannot be changed after
                creation. Choose carefully.
              </Typography>
            </Alert>
          </Box>
        </SimpleForm>
      </Box>
    </Create>
  );
};
