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
  CircularProgress,
  Chip,
  Alert,
} from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useNavigate } from 'react-router-dom';

/**
 * TenantAdminList Component
 * 
 * Displays TA administrators for a tenant with actions:
 * - Invite new TA admin (SA or SPA only)
 * - Change TA admin to SPA role (SA or SPA only)
 * - Delete TA admin (SA or SPA only)
 */
export const TenantAdminList = ({ tenantId, orgId }) => {
  const { permissions } = usePermissions();
  const navigate = useNavigate();
  const notify = useNotify();
  const refresh = useRefresh();

  const taGroup = `TA_${tenantId}`;
  const spaGroup = `SPA_${orgId}`;

  // Fetch TA admins for this tenant
  const { data: admins, isLoading, error } = useGetList('admins', {
    pagination: { page: 1, perPage: 50 },
    sort: { field: 'email', order: 'ASC' },
    filter: { groups: taGroup },
  });

  const [update, { isLoading: isUpdating }] = useUpdate();
  const [deleteOne, { isLoading: isDeleting }] = useDelete();

  // Menu state
  const [anchorEl, setAnchorEl] = useState(null);
  const [selectedAdmin, setSelectedAdmin] = useState(null);

  // Change to SPA dialog state
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // SA or SPA can manage TA admins
  const canManage = permissions?.isSA === true || permissions?.isSPA === true;

  const handleMenuOpen = (event, admin) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setSelectedAdmin(admin);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleInviteTA = () => {
    navigate('/admins/create', {
      state: { record: { groups: [taGroup] } },
    });
  };

  // Change to SPA handlers
  const handleChangeToSPAOpen = () => {
    setChangeDialogOpen(true);
    handleMenuClose();
  };

  const handleChangeToSPAConfirm = () => {
    if (!selectedAdmin || !orgId) return;

    update(
      'admins',
      {
        id: selectedAdmin.id,
        data: { ...selectedAdmin, groups: [spaGroup] },
        previousData: selectedAdmin,
      },
      {
        onSuccess: () => {
          notify('Admin role changed to Organization Admin (SPA) successfully', { type: 'success' });
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

  const handleChangeToSPACancel = () => {
    setChangeDialogOpen(false);
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
            Tenant Administrators
          </Typography>
          {canManage && (
            <Button
              variant="contained"
              size="small"
              startIcon={<PersonAddIcon />}
              onClick={handleInviteTA}
            >
              Invite Admin
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
            No tenant administrators found for this tenant.
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
                        label={`TA • ${tenantId}`}
                        color="warning"
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
          {orgId && (
            <MenuItem onClick={handleChangeToSPAOpen}>
              Change to Org Admin (SPA)
            </MenuItem>
          )}
          <MenuItem onClick={handleDeleteOpen} sx={{ color: 'error.main' }}>
            Delete User
          </MenuItem>
        </Menu>

        {/* Change to SPA Confirmation Dialog */}
        <Dialog
          open={changeDialogOpen}
          onClose={handleChangeToSPACancel}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>Change to Organization Admin</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Change <strong>{selectedAdmin?.email}</strong> from Tenant Admin
              (TA) to Organization Admin (SPA) for organization <strong>{orgId}</strong>?
            </Typography>
            <Alert severity="info" sx={{ mt: 1 }}>
              This will remove the TA role for tenant <strong>{tenantId}</strong> and 
              assign the SPA role for organization <strong>{orgId}</strong>.
              The user will gain access to all tenants within this organization.
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleChangeToSPACancel}>Cancel</Button>
            <Button
              onClick={handleChangeToSPAConfirm}
              variant="contained"
              disabled={isUpdating}
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

export default TenantAdminList;