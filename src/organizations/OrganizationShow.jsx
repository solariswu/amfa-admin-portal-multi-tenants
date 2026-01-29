import React from 'react';
import {
  Show,
  SimpleShowLayout,
  TextField,
  DateField,
  ListButton,
  TopToolbar,
  ReferenceManyField,
  Datagrid,
  useRecordContext,
  CreateButton,
  usePermissions
} from 'react-admin';
import { Box, Card, CardContent, Typography, Divider } from '@mui/material';
import { useNavigate } from 'react-router-dom';

/**
 * Show Actions with Edit and List buttons
 */
const ShowActions = () => {
  const record = useRecordContext();
  const { permissions } = usePermissions();
  const navigate = useNavigate();
  
  const handleCreateTenant = () => {
    // Navigate to tenant create with org pre-selected
    navigate('/tenants/create', { state: { record: { org_id: record?.id } } });
  };
  
  return (
    <TopToolbar>
      {permissions?.isSA && record?.id && (
        <CreateButton 
          label="Create Tenant for this Org"
          onClick={handleCreateTenant}
        />
      )}
      <ListButton />
    </TopToolbar>
  );
};

/**
 * OrganizationShow Component
 * Displays detailed view of an organization
 */
export const OrganizationShow = () => {
  return (
    <Show actions={<ShowActions />}>
      <Box p={3}>
        <Card>
          <CardContent>
            <Typography variant="h5" gutterBottom>
              Organization Details
            </Typography>
            <Divider sx={{ my: 2 }} />

            <SimpleShowLayout>
              <TextField source="id" label="Organization ID" />
              <TextField source="name" label="Name" />
              <TextField
                source="description"
                label="Description"
                emptyText="No description provided"
              />

              <Divider sx={{ my: 2 }} />

              <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                Metadata
              </Typography>

              <TextField source="created_by" label="Created By" />
              <TextField
                source="created_by_name"
                label="Creator Name"
                emptyText="N/A"
              />
              <DateField
                source="created_at"
                label="Created At"
                showTime
                emptyText="N/A"
              />
            </SimpleShowLayout>
          </CardContent>
        </Card>

        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="h5" gutterBottom>
              Tenants in this Organization
            </Typography>
            <Divider sx={{ my: 2 }} />

            <ReferenceManyField
              reference="tenants"
              target="org_id"
              label={false}
            >
              <Datagrid 
                rowClick="show"
                bulkActionButtons={false}
                sx={{ 
                  '& .RaDatagrid-headerCell': { 
                    fontWeight: 'bold' 
                  } 
                }}
              >
                <TextField source="name" label="Tenant Name" />
                <TextField source="id" label="Tenant ID" />
                <TextField source="contact" label="Contact Email" />
                <DateField source="created_at" label="Created" showTime />
              </Datagrid>
            </ReferenceManyField>
          </CardContent>
        </Card>
      </Box>
    </Show>
  );
};
