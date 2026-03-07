import React, { useState, useEffect, useCallback } from 'react';
import {
  Create,
  SimpleForm,
  TextInput,
  required,
  useNotify,
  useRedirect,
  useCreate,
} from 'react-admin';
import {
  Box,
  Typography,
  Avatar,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Button,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
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
 * 
 * If the ASM install key is not configured in Secrets Manager,
 * a dialog prompts the SA to enter it (one-time setup).
 */
export const OrganizationCreate = () => {
  const notify = useNotify();
  const redirect = useRedirect();
  const [loading, setLoading] = useState(true);
  const [canCreate, setCanCreate] = useState(false);
  
  // Install key dialog state
  const [installKeyDialogOpen, setInstallKeyDialogOpen] = useState(false);
  const [installKeyValue, setInstallKeyValue] = useState('');
  const [pendingData, setPendingData] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  
  const [create] = useCreate();

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

  const handleCreate = (data) => {
    create(
      'organizations',
      { data },
      {
        onSuccess: (result) => {
          notify(`IT Svc Org "${result.name}" created successfully!`, { type: 'success' });
          redirect('show', 'organizations', result.id);
        },
        onError: (error) => {
          // Check if the error is ASM_INSTALL_KEY_REQUIRED
          const errorBody = error?.body || error;
          const errorCode = errorBody?.code;
          const errorMessage = errorBody?.message || error?.message || '';
          
          if (errorCode === 'ASM_INSTALL_KEY_REQUIRED' || errorMessage.includes('ASM_INSTALL_KEY_REQUIRED')) {
            // Store the pending data and show install key dialog
            setPendingData(data);
            setInstallKeyDialogOpen(true);
          } else {
            notify(`Failed to create IT Svc Org: ${errorMessage}`, { type: 'error' });
          }
        },
      }
    );
  };

  const handleInstallKeySubmit = async () => {
    if (!installKeyValue.trim() || !pendingData) return;
    
    setSubmitting(true);
    
    // Re-submit with install key included
    create(
      'organizations',
      { data: { ...pendingData, asmInstallKey: installKeyValue.trim() } },
      {
        onSuccess: (result) => {
          setInstallKeyDialogOpen(false);
          setInstallKeyValue('');
          setPendingData(null);
          setSubmitting(false);
          notify(`IT Svc Org "${result.name}" created successfully! ASM Install Key has been saved for future use.`, { type: 'success' });
          redirect('show', 'organizations', result.id);
        },
        onError: (error) => {
          setSubmitting(false);
          const errorMessage = error?.body?.message || error?.message || 'Unknown error';
          notify(`Failed: ${errorMessage}`, { type: 'error' });
        },
      }
    );
  };

  const handleInstallKeyCancel = () => {
    setInstallKeyDialogOpen(false);
    setInstallKeyValue('');
    setPendingData(null);
    setSubmitting(false);
  };

  return (
    <>
      <Create
        title="Create New IT Svc Org"
        redirect={false}
        mutationOptions={{
          onSuccess: (data) => {
            notify(`IT Svc Org "${data.name}" created successfully!`, { type: 'success' });
            redirect('show', 'organizations', data.id);
          },
          onError: (error) => {
            const errorBody = error?.body || error;
            const errorCode = errorBody?.code;
            const errorMessage = errorBody?.message || error?.message || '';
            
            if (errorCode === 'ASM_INSTALL_KEY_REQUIRED' || errorMessage.includes('ASM_INSTALL_KEY_REQUIRED')) {
              // Will be handled by transform + save pattern below
            } else {
              notify(`Failed to create IT Svc Org: ${errorMessage}`, { type: 'error' });
            }
          },
        }}
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

      {/* ASM Install Key Dialog — shown only when key is not found in Secrets Manager */}
      <Dialog
        open={installKeyDialogOpen}
        onClose={handleInstallKeyCancel}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <VpnKeyIcon color="warning" />
          ASM Install Key Required
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            The ASM Install Key has not been configured yet. This is a one-time setup required to register 
            organizations with the aPersona ASM portal. The key will be securely stored for future use.
          </DialogContentText>
          <TextField
            autoFocus
            label="ASM Install Key"
            type="password"
            fullWidth
            variant="outlined"
            value={installKeyValue}
            onChange={(e) => setInstallKeyValue(e.target.value)}
            disabled={submitting}
            helperText="Enter the install key you received from aPersona registration"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && installKeyValue.trim()) {
                handleInstallKeySubmit();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleInstallKeyCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleInstallKeySubmit}
            variant="contained"
            disabled={!installKeyValue.trim() || submitting}
            startIcon={submitting ? <CircularProgress size={16} /> : null}
          >
            {submitting ? 'Creating...' : 'Submit & Create Org'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};