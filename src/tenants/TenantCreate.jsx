import React, { useState, useEffect } from 'react';
import {
  Create,
  Form,
  TextInput,
  SelectInput,
  BooleanInput,
  SaveButton,
  useGetList,
  useNotify,
  useRedirect,
  required,
  email,
} from 'react-admin';
import {
  Grid,
  Typography,
  Avatar,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Alert,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import { getRoleFromToken } from '../utils/roleUtils';

/**
 * Validation: Tenant ID must be lowercase alphanumeric only, max 36 chars
 */
const validateTenantId = (value) => {
  if (!value) {
    return 'Tenant ID is required';
  }
  if (!/^[a-z0-9]{1,36}$/.test(value)) {
    return 'Tenant ID must be lowercase alphanumeric (a-z, 0-9), max 36 characters';
  }
  return undefined;
};

/**
 * Validation: Tenant Name max 100 chars
 */
const validateTenantName = (value) => {
  if (!value) {
    return 'Tenant Name is required';
  }
  if (value.length > 100) {
    return 'Tenant Name must be max 100 characters';
  }
  return undefined;
};

export const TenantCreate = () => {
  const notify = useNotify();
  const redirect = useRedirect();
  const [roleInfo, setRoleInfo] = useState({ role: null, orgId: null });
  const [loading, setLoading] = useState(true);

  // Get organizations for SA
  const { data: orgs, isLoading: orgsLoading } = useGetList(
    'organizations',
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: 'name', order: 'ASC' }
    }
  );

  useEffect(() => {
    const token = localStorage.getItem('token');
    const info = getRoleFromToken(token);
    setRoleInfo(info);
    setLoading(false);
  }, []);

  // Show loading spinner while checking role
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="80vh">
        <CircularProgress />
      </Box>
    );
  }

  // Check permission: Only SA and SPA can create tenants
  if (!roleInfo.role || (roleInfo.role !== 'SA' && roleInfo.role !== 'SPA')) {
    return (
      <Box p={3}>
        <Alert severity="error">
          <Typography variant="h6">
            Insufficient Permissions
          </Typography>
          <Typography variant="body2">
            You don't have permission to create tenants. Only Super Admins and Service Provider Admins can create tenants.
          </Typography>
        </Alert>
      </Box>
    );
  }

  // Transform data before sending to API
  const transform = (data) => {
    return {
      data: {
        tenantId: data.tenantId.toLowerCase(), // Force lowercase
        tenantName: data.tenantName.trim(),
        orgId: roleInfo.role === 'SPA' ? roleInfo.orgId : data.orgId,
        samlproxy: data.samlproxy !== false, // Default true
        // Admin invitation is mandatory
        adminEmail: data.adminEmail.toLowerCase().trim(),
        adminFirstName: data.adminFirstName?.trim(),
        adminLastName: data.adminLastName?.trim(),
      }
    };
  };

  const onSuccess = (data) => {
    notify(`Tenant "${data.name || data.id}" created successfully!`, { 
      type: 'success',
      multiLine: true 
    });
    redirect('show', 'tenants', data.id);
  };

  const onError = (error) => {
    console.error('Tenant creation error:', error);
    
    // Extract status code from error object
    const statusCode = error.status || error.statusCode || (error.body && error.body.statusCode);
    
    // Handle different error types with user-friendly messages
    if (statusCode === 409) {
      // HTTP 409 Conflict - Duplicate tenant ID
      notify(
        'This Tenant ID already exists. Please choose a different Tenant ID and try again.', 
        { 
          type: 'warning',
          multiLine: true,
          autoHideDuration: 6000
        }
      );
    } else if (statusCode === 403) {
      // HTTP 403 Forbidden - Permission denied
      notify(
        `Permission denied: You don't have permission to create tenants in this organization.`, 
        { 
          type: 'error',
          multiLine: true,
          autoHideDuration: 6000
        }
      );
    } else if (statusCode === 400) {
      // HTTP 400 Bad Request - Validation error
      notify(
        `Invalid tenant data: ${error.message || 'Please check your input and try again.'}`, 
        { 
          type: 'error',
          multiLine: true,
          autoHideDuration: 6000
        }
      );
    } else if (statusCode >= 500) {
      // HTTP 5xx - Server error
      notify(
        `Server error: Failed to create tenant. Please try again later or contact support.`, 
        { 
          type: 'error',
          multiLine: true,
          autoHideDuration: 8000
        }
      );
    } else {
      // Generic error
      notify(
        `Failed to create tenant: ${error.message || 'An unexpected error occurred.'}`, 
        { 
          type: 'error',
          multiLine: true,
          autoHideDuration: 6000
        }
      );
    }
  };

  return (
    <Create
      title="Create New Tenant"
      redirect="show"
      transform={transform}
      mutationOptions={{ onSuccess, onError }}
    >
      <Box display="flex" flexDirection="column" alignItems="center" p={3}>
        <Avatar sx={{ m: 1, bgcolor: 'primary.main', width: 56, height: 56 }}>
          <BusinessIcon fontSize="large" />
        </Avatar>
        <Typography component="h1" variant="h4" mb={1}>
          Create New Tenant
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={3}>
          {roleInfo.role === 'SA' 
            ? 'Create a new tenant for any organization' 
            : `Create a new tenant for your organization (${roleInfo.orgId})`
          }
        </Typography>

        <Form>
          <Card sx={{ maxWidth: 900, width: '100%' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Tenant Information
              </Typography>

              <Grid container spacing={3}>
                {/* Tenant ID */}
                <Grid item xs={12} sm={6}>
                  <TextInput
                    source="tenantId"
                    label="Tenant ID"
                    validate={[required(), validateTenantId]}
                    helperText="Lowercase alphanumeric only (a-z, 0-9), max 36 chars. Will be used in URL: tenantId.example.com"
                    fullWidth
                    inputProps={{
                      style: { textTransform: 'lowercase' }
                    }}
                  />
                </Grid>

                {/* Tenant Name */}
                <Grid item xs={12} sm={6}>
                  <TextInput
                    source="tenantName"
                    label="Tenant Display Name"
                    validate={[required(), validateTenantName]}
                    helperText="Display name for the tenant (max 100 chars)"
                    fullWidth
                  />
                </Grid>

                {/* Organization - Different for SA vs SPA */}
                <Grid item xs={12} sm={6}>
                  {roleInfo.role === 'SA' ? (
                    <SelectInput
                      source="orgId"
                      label="Organization"
                      choices={orgs?.map(org => ({ 
                        id: org.id, 
                        name: org.name || org.id 
                      })) || []}
                      validate={required()}
                      helperText="Select the organization for this tenant"
                      fullWidth
                      isLoading={orgsLoading}
                    />
                  ) : (
                    <TextInput
                      source="orgId"
                      label="Organization"
                      defaultValue={roleInfo.orgId}
                      disabled
                      helperText="Your organization (cannot be changed)"
                      fullWidth
                    />
                  )}
                </Grid>

                {/* SAML Proxy */}
                <Grid item xs={12}>
                  <BooleanInput
                    source="samlproxy"
                    label="Enable SAML Proxy"
                    defaultValue={true}
                    helperText="Enable SAML authentication for this tenant"
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Initial Tenant Admin Invitation (Mandatory) */}
          <Card sx={{ maxWidth: 900, width: '100%', mt: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Initial Tenant Admin
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    The user will be created in the admin UserPool and added to the TA_{'<tenantId>'} group. 
                    They will receive an invitation email with temporary password.
                  </Alert>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextInput
                    source="adminEmail"
                    label="Admin Email"
                    type="email"
                    validate={[required(), email()]}
                    helperText="Email for the initial tenant admin user (required)"
                    fullWidth
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextInput
                    source="adminFirstName"
                    label="First Name"
                    helperText="Admin's first name"
                    fullWidth
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextInput
                    source="adminLastName"
                    label="Last Name"
                    helperText="Admin's last name"
                    fullWidth
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Submit Button */}
          <Box mt={3} display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" color="text.secondary">
              * Required fields
            </Typography>
            <SaveButton 
              label="Create Tenant" 
              icon={<BusinessIcon />}
              sx={{ minWidth: 150 }}
            />
          </Box>
        </Form>
      </Box>
    </Create>
  );
};
