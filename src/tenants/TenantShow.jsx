import { useState, useEffect, useMemo } from 'react';
import {
  Show,
  SimpleShowLayout,
  TextField,
  FunctionField,
  TopToolbar,
  ListButton,
  DeleteWithConfirmButton,
  useRecordContext,
  usePermissions,
  useGetList,
  Link,
} from 'react-admin';
import { Box, Card, CardContent, Typography, Divider } from '@mui/material';
import { TenantAdminList } from './TenantAdminList';

/**
 * Show Actions with Delete button in upper right.
 * 
 * Delete is allowed for:
 * - SA (Super Admin): can delete any tenant
 * - SPA (Service Provider Admin): can delete tenants belonging to their organization
 */
const ShowActions = () => {
  const record = useRecordContext();
  const { permissions } = usePermissions();

  const canDelete = permissions?.isSA || 
    (permissions?.isSPA && permissions?.orgId === record?.org_id);

  return (
    <TopToolbar>
      {canDelete && record?.id && (
        <DeleteWithConfirmButton
          confirmTitle={`Delete Tenant "${record?.name}"?`}
          confirmContent="This will delete the tenant and all resources except tenant userpool."
          mutationMode="pessimistic"
          redirect="list"
        />
      )}
      <ListButton />
    </TopToolbar>
  );
};

/**
 * TenantShow Component
 * Displays detailed view of a tenant with delete button for SA/SPA.
 */
export const TenantShow = () => {
  // Load organizations to display org name
  const { data: organizations } = useGetList('organizations', {
    pagination: { page: 1, perPage: 1000 },
  });

  const orgMap = useMemo(() => {
    if (!organizations) return {};
    return organizations.reduce((map, org) => {
      map[org.id] = org.name;
      return map;
    }, {});
  }, [organizations]);

  return (
    <Show actions={<ShowActions />}>
      <Box p={3}>
        <Card>
          <CardContent>
            <Typography variant="h5" gutterBottom>
              Tenant Details
            </Typography>
            <Divider sx={{ my: 2 }} />

            <SimpleShowLayout>
              <TextField source="id" label="Tenant ID" />
              <TextField source="name" label="Tenant Name" />
              <TextField source="contact" label="Contact Email" />
              <FunctionField
                label="IT Svc Org"
                render={record => {
                  const orgName = orgMap[record.org_id] || record.org_id || 'N/A';
                  return record.org_id ? (
                    <Link to={`/organizations/${record.org_id}/show`}>
                      {orgName}
                    </Link>
                  ) : orgName;
                }}
              />
              <FunctionField
                label="End User Service Portal URL"
                render={record => record.endUserSpUrl ? (
                  <a href={record.endUserSpUrl} target="_blank" rel="noreferrer">
                    {record.endUserSpUrl}
                  </a>
                ) : '---'}
              />
            </SimpleShowLayout>
          </CardContent>
        </Card>

        {/* Tenant Administrators Section */}
        <TenantAdminListWrapper />
      </Box>
    </Show>
  );
};

/**
 * Wrapper to extract tenant ID and org ID from record context for TenantAdminList
 */
const TenantAdminListWrapper = () => {
  const record = useRecordContext();
  if (!record?.id) return null;
  return <TenantAdminList tenantId={record.id} orgId={record.org_id} />;
};