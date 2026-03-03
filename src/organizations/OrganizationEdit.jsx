import React from 'react';
import {
  Edit,
  SimpleForm,
  TextInput,
  required,
  usePermissions
} from 'react-admin';
import { Typography, Box } from '@mui/material';

const OrganizationEdit = () => {
  const { permissions } = usePermissions();
  
  // Only SA can edit organizations
  if (!permissions?.isSA) {
    return (
      <Box p={2}>
        <Typography color="error">
          Only Super Admins can edit IT Svc Orgs.
        </Typography>
      </Box>
    );
  }

  return (
    <Edit mutationMode="pessimistic">
      <SimpleForm>
        <Typography variant="h6" gutterBottom>
          Edit IT Svc Org
        </Typography>
        
        <TextInput 
          source="id" 
          label="IT Svc Org ID" 
          disabled
          fullWidth
          helperText="IT Svc Org ID cannot be changed"
        />
        
        <TextInput 
          source="name" 
          label="Name"
          validate={required()}
          fullWidth
        />
        
        <TextInput 
          source="description" 
          label="Description"
          multiline
          rows={4}
          fullWidth
        />

        <Typography variant="caption" color="textSecondary" sx={{ mt: 2 }}>
          Note: Changing IT Svc Org details will not affect existing tenants or their configurations.
        </Typography>
      </SimpleForm>
    </Edit>
  );
};

export default OrganizationEdit;
