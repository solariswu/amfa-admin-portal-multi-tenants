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
  usePermissions,
  DeleteWithConfirmButton,
  useGetManyReference,
} from 'react-admin';
import { Box, Card, CardContent, Typography, Divider, Button, Alert } from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useNavigate } from 'react-router-dom';
import { OrgAdminList } from './OrgAdminList';

/**
 * Show Actions with Delete and List buttons
 * Delete button replaces the old "Create Tenant" position
 */
const ShowActions = () => {
  const record = useRecordContext();
  const { permissions } = usePermissions();

  // Check if org has tenants to control delete button
  const { data: tenants, isLoading } = useGetManyReference('tenants', {
    target: 'org_id',
    id: record?.id,
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'id', order: 'ASC' },
  }, { enabled: !!record?.id });

  const hasTenants = !isLoading && tenants && tenants.length > 0;

  return (
    <TopToolbar>
      {permissions?.isSA && record?.id && !hasTenants && (
        <DeleteWithConfirmButton
          confirmTitle={`Delete Organization "${record?.name}"?`}
          confirmContent="This action cannot be undone. The organization and its associated SPA group will be permanently removed."
          redirect="list"
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
              <TextField source="created_by" label="Created By" />
              <DateField
                source="created_at"
                label="Created At"
                showTime
                emptyText="N/A"
              />
            </SimpleShowLayout>
          </CardContent>
        </Card>

        <OrgAdminListWrapper />

        <TenantListCard />
      </Box>
    </Show>
  );
};

/**
 * Tenant List Card with "Create Tenant" button (similar to OrgAdminList's "Invite SPA Admin")
 */
const TenantListCard = () => {
  const record = useRecordContext();
  const { permissions } = usePermissions();
  const navigate = useNavigate();

  const handleCreateTenant = () => {
    navigate('/tenants/create', { state: { record: { org_id: record?.id } } });
  };

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="h5" gutterBottom>
            Tenants in this Organization
          </Typography>
          {(permissions?.isSA || (permissions?.isSPA && permissions?.orgId === record?.id)) && record?.id && (
            <Button
              variant="contained"
              size="small"
              startIcon={<PersonAddIcon />}
              onClick={handleCreateTenant}
            >
              Create Tenant
            </Button>
          )}
        </Box>
        <Divider sx={{ my: 2 }} />

        <ReferenceManyField
          reference="tenants"
          target="org_id"
          label={false}
        >
          <TenantDatagridOrEmpty />
        </ReferenceManyField>
      </CardContent>
    </Card>
  );
};

/**
 * Shows tenant datagrid or empty message
 */
const TenantDatagridOrEmpty = () => {
  return (
    <Datagrid
      rowClick="show"
      bulkActionButtons={false}
      empty={
        <Typography color="text.secondary" sx={{ py: 2 }}>
          No tenants found for this organization.
        </Typography>
      }
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
  );
};

/**
 * Wrapper to extract org ID from record context for OrgAdminList
 */
const OrgAdminListWrapper = () => {
  const record = useRecordContext();
  if (!record?.id) return null;
  return <OrgAdminList orgId={record.id} />;
};