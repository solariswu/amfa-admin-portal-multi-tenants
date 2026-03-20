import { useMemo, useState, useEffect, useRef } from 'react';
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
import {
  Box,
  Card,
  CardContent,
  Typography,
  Divider,
  Tabs,
  Tab,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import SettingsIcon from '@mui/icons-material/Settings';
import PaletteIcon from '@mui/icons-material/Palette';
import EmailIcon from '@mui/icons-material/Email';
import { TenantAdminList } from './TenantAdminList';
import { TenantSettingsTab } from './TenantSettingsTab';
import { TenantBrandingTab } from './TenantBrandingTab';
import { TenantSmtpTab } from './TenantSmtpTab';
import { useTenantContext } from '../contexts/TenantContext';

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
 * Simple TabPanel component (avoids @mui/lab dependency)
 */
const TabPanel = ({ children, value, index, ...other }) => (
  <div
    role="tabpanel"
    hidden={value !== index}
    id={`tenant-tabpanel-${index}`}
    aria-labelledby={`tenant-tab-${index}`}
    {...other}
  >
    {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
  </div>
);

/**
 * Details tab content - tenant info and administrators
 */
const TenantDetailsTab = ({ orgMap }) => {
  const record = useRecordContext();

  return (
    <>
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
      {record?.id && (
        <TenantAdminList tenantId={record.id} orgId={record.org_id} />
      )}
    </>
  );
};

/**
 * One-way sync: when the tenant show record loads, update the sidebar dropdown to match.
 * Navigation in the reverse direction (dropdown → show page) is handled by TenantSelector directly.
 */
const TenantContextSyncer = () => {
  const record = useRecordContext();
  const { setSelectedTenant } = useTenantContext();
  const lastSyncedRecordId = useRef(null);

  useEffect(() => {
    if (record?.id && record.id !== lastSyncedRecordId.current) {
      lastSyncedRecordId.current = record.id;
      setSelectedTenant(record.id, record.name || record.id);
    }
  }, [record?.id, record?.name, setSelectedTenant]);

  return null;
};

/**
 * TenantShow Component
 * Displays detailed view of a tenant with tabbed layout:
 * - Details: basic info + administrators
 * - Settings: read-only view of tenant settings
 * - Branding: read-only view of login service + end user portal branding
 * 
 * Syncs with sidebar TenantSelector:
 * - Auto-selects the viewed tenant in the dropdown
 * - Navigates to a new tenant when dropdown selection changes
 */
export const TenantShow = () => {
  const [tabIndex, setTabIndex] = useState(0);

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

  const handleTabChange = (event, newValue) => {
    setTabIndex(newValue);
  };

  return (
    <Show actions={<ShowActions />}>
      {/* Bidirectional sync between record and sidebar tenant dropdown */}
      <TenantContextSyncer />
      <Box sx={{ px: 3, pt: 1, pb: 3 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={tabIndex}
            onChange={handleTabChange}
            aria-label="Tenant show tabs"
            variant="standard"
          >
            <Tab
              icon={<InfoIcon />}
              iconPosition="start"
              label="Details"
              id="tenant-tab-0"
              aria-controls="tenant-tabpanel-0"
            />
            <Tab
              icon={<SettingsIcon />}
              iconPosition="start"
              label="Settings"
              id="tenant-tab-1"
              aria-controls="tenant-tabpanel-1"
            />
            <Tab
              icon={<PaletteIcon />}
              iconPosition="start"
              label="Branding"
              id="tenant-tab-2"
              aria-controls="tenant-tabpanel-2"
            />
            <Tab
              icon={<EmailIcon />}
              iconPosition="start"
              label="SMTP"
              id="tenant-tab-3"
              aria-controls="tenant-tabpanel-3"
            />
          </Tabs>
        </Box>

        <TabPanel value={tabIndex} index={0}>
          <TenantDetailsTab orgMap={orgMap} />
        </TabPanel>

        <TabPanel value={tabIndex} index={1}>
          <TenantSettingsTab />
        </TabPanel>

        <TabPanel value={tabIndex} index={2}>
          <TenantBrandingTab />
        </TabPanel>

        <TabPanel value={tabIndex} index={3}>
          <TenantSmtpTab />
        </TabPanel>
      </Box>
    </Show>
  );
};
