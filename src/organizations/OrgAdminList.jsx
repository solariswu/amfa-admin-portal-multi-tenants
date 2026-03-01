import React, { useState } from 'react';
import {
  useGetList,
  useUpdate,
  useDelete,
  usePermissions,
  useNotify,
  useRefresh,
  Confirm,
} from 'react-admin';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Divider,
  Button,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  CircularProgress,
  Chip,
  Alert,
} from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useNavigate } from 'react-router-dom';

/**
 * OrgAdminList Component
 * 
 * Displays SPA administrators for an organization with actions:
 * - Invite new SPA admin (SA only)
 * - Change SPA admin to TA role (SA only)
 * - Delete SPA admin (SA only)
 */
export const OrgAdminList = ({ orgId }) => {
  const { permissions } = usePermissions();
  const navigate = useNavigate();
  const notify = useNotify();
  const refresh = useRefresh();

  const spaGroup = `SPA_${orgId}`;

  // Fetch SPA admins for this org
  const { data: admins, isLoading, error } = useGetList('admins', {
    pagination: { page: 1, perPage: 50 },
    sort: { field: 'email', order: 'ASC' },
    filter: { groups: spaGroup },
  });

  // Fetch tenants in this org (for "Change to TA" dialog)
  const { data: tenants } = useGetList('tenants', {
    pagination: { page: 1, perPage: 100 },
    sort: { field: 'name', order: 'ASC' },
    filter: { org_id: orgId },
  });

  const [update, { isLoading: isUpdating }] = useUpdate();
  const [deleteOne, { isLoading: isDeleting }] = useDelete();

  // Menu state
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedAdmin, setSelectedAdmin] = useState(null);

  // Change to TA dialog state
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState('');

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const canManage = permissions?.isSA === true;

  const handleMenuOpen = (event, admin) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setSelectedAdmin(admin);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleInviteSPA = () => {
    navigate('/admins/create', {
      state: { record: { groups: [spaGroup] } },
    });
  };

  // Change to TA handlers
  const handleChangeToTAOpen = () => {
    setChangeDialogOpen(true);
    setSelectedTenantId('');
    handleMenuClose();
  };

  const handleChangeToTAConfirm = () => {
    if (!selectedAdmin || !selectedTenantId) return;

    const newGroup = `TA_${selectedTenantId}`;
    update(
      'admins',
      {
        id: selectedAdmin.id,
        data: { ...selectedAdmin, groups: [newGroup] },
        previousData: selectedAdmin,
      },
      {
        onSuccess: () => {
          notify('Admin role changed to Tenant Admin successfully', { type: 'success' });
          setChangeDialogOpen(false);
          setSelectedAdmin(null);
          refresh();
        },
        onError: (error) => {
          notify(`Error: ${error.message}`, { type: 'error' });
        },
      }
    );
  };

  const handleChangeToTACancel = () => {
    setChangeDialogOpen(false);
    setSelectedTenantId('');
  };

  // Delete handlers
  const handleDeleteOpen = () => {
    setDeleteConfirmOpen(true);
    handleMenuClose();
  };

  const handleDeleteConfirm = () => {
    if (!selectedAdmin) return;

    deleteOne(
      'admins',
      {
        id: selectedAdmin.id,
        previousData: selectedAdmin,
      },
      {
        onSuccess: () => {
          notify('Admin deleted successfully', { type: 'success' });
          setDeleteConfirmOpen(false);
          setSelectedAdmin(null);
          refresh();
        },
        onError: (error) => {
          notify(`Error: ${error.message}`, { type: 'error' });
        },
      }
    );
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmOpen(false);
    setSelectedAdmin(null);
  };

  const getStatusLabel = (admin) => {
    if (!admin.enabled) return 'Disabled';
    if (admin.status === 'EXTERNAL_PROVIDER') return 'Super Admin';
    return admin.status || 'Active';
  };

  const getStatusColor = (admin) => {
    if (!admin.enabled) return 'default';
    if (admin.status === 'CONFIRMED') return 'success';
    if (admin.status === 'FORCE_CHANGE_PASSWORD') return 'warning';
    return 'info';
  };

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="h5" gutterBottom>
            Organization Administrators
          </Typography>
          {canManage && (
            <Button
              variant="contained"
              size="small"
              startIcon={<PersonAddIcon />}
              onClick={handleInviteSPA}
            >
              Invite SPA Admin
            </Button>
          )}
        </Box>
        <Divider sx={{ my: 2 }} />

        {isLoading ? (
          <Box display="flex" justifyContent="center" p={3}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error">Failed to load administrators</Alert>
        ) : !admins || admins.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            No SPA administrators found for this organization.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>Email</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Full Name</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Role</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                  {canManage && (
                    <TableCell sx={{ fontWeight: 'bold' }} align="right">Actions</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {admins.map((admin) => (
                  <TableRow key={admin.id} hover>
                    <TableCell sx={{ color: '#1A76D2' }}>{admin.email}</TableCell>
                    <TableCell>
                      {`${admin.given_name || ''} ${admin.family_name || ''}`.trim() || '—'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={`SPA • ${orgId}`}
                        color="info"
                        size="small"
                        sx={{ fontWeight: 500 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={getStatusLabel(admin)}
                        color={getStatusColor(admin)}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    {canManage && (
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={(e) => handleMenuOpen(e, admin)}
                        >
                          <MoreHorizIcon color="primary" />
                        </IconButton>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Actions Menu */}
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
        >
          <MenuItem disabled sx={{ color: 'text.primary', fontWeight: 'medium' }}>
            {selectedAdmin?.email}
          </MenuItem>
          <MenuItem onClick={handleChangeToTAOpen}>
            Change to Tenant Admin
          </MenuItem>
          <MenuItem onClick={handleDeleteOpen} sx={{ color: 'error.main' }}>
            Delete User
          </MenuItem>
        </Menu>

        {/* Change to TA Dialog */}
        <Dialog
          open={changeDialogOpen}
          onClose={handleChangeToTACancel}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Change to Tenant Admin</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Change <strong>{selectedAdmin?.email}</strong> from Organization Admin
              (SPA) to Tenant Admin (TA). Select the tenant to assign:
            </Typography>
            <FormControl fullWidth sx={{ mt: 1 }}>
              <InputLabel>Select Tenant</InputLabel>
              <Select
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                label="Select Tenant"
              >
                {tenants?.map((tenant) => (
                  <MenuItem key={tenant.id} value={tenant.id}>
                    {decodeURIComponent(tenant.name)} ({tenant.id})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {tenants?.length === 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                No tenants found in this organization. Create a tenant first.
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleChangeToTACancel}>Cancel</Button>
            <Button
              onClick={handleChangeToTAConfirm}
              variant="contained"
              disabled={!selectedTenantId || isUpdating}
              startIcon={isUpdating ? <CircularProgress size={16} /> : null}
            >
              Confirm Change
            </Button>
          </DialogActions>
        </Dialog>

        {/* Delete Confirmation */}
        <Confirm
          isOpen={deleteConfirmOpen}
          loading={isDeleting}
          title={`Delete admin ${selectedAdmin?.email || ''}`}
          content="Are you sure you want to remove all roles and delete this user? This action cannot be undone."
          onConfirm={handleDeleteConfirm}
          onClose={handleDeleteCancel}
        />
      </CardContent>
    </Card>
  );
};

export default OrgAdminList;