import * as React from 'react';
import IconButton from '@mui/material/IconButton';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { Confirm, useRedirect, useDelete, useUpdate } from 'react-admin';

export default function AdminListMenu({ record }) {
    const [anchorEl, setAnchorEl] = React.useState(null);
    const [confirmType, setConfirmType] = React.useState(null);
    const [deleteOne, { isLoading: isDeleting }] = useDelete(
        'admins',
        { id: record.id, previousData: record }
    );

    const [update, { isLoading: isUpdating }] = useUpdate();

    const redirect = useRedirect();

    const open = Boolean(anchorEl);
    const handleClick = (event) => {
        setAnchorEl(event.currentTarget);
    };
    const handleClose = () => {
        setAnchorEl(null);
    };
    const handle = (type) => {
        setAnchorEl(null);
        setConfirmType(type);
    }

    const confirmData = {
        disable: {
            title: 'Disable user ',
            content: 'disable this user?'
        },
        enable: {
            title: 'Enable user ',
            content: 'enable this user?'
        },
        delete: {
            title: 'Delete user ',
            content: 'delete this user?'
        },
        reset: {
            title: 'Reset user password of ',
            content: 'reset this user password?'
        }
    }

    const handleConfirm = (type) => {
        switch (type) {
            case 'disable':
                update(
                    'admins',
                    { id: record.id, data: { ...record, enabled: false }, previousData: record }
                );
                break;
            case 'enable':
                update(
                    'admins',
                    { id: record.id, data: { ...record, enabled: true }, previousData: record }
                );
                break;
            case 'delete':
                deleteOne();
                break;
            case 'reset':
                update(
                    'admins',
                    { id: record.id, data: { ...record, resetpassword: true }, previousData: record }
                )
                break;
            default:
                break;
        }
        setConfirmType(null);
        setAnchorEl(null);
    }

    return (
        <div>
            <Confirm
                isOpen={confirmType !== null || isDeleting || isUpdating}
                loading={isDeleting || isUpdating}
                title={
                    isDeleting ? `deleting ${record && record.email}` :
                        (isUpdating ? `updating ${record && record.email}` :
                            `${confirmData[confirmType]?.title} ${record && record.email}`)}
                content={isDeleting || isUpdating ? '' : `Are you sure you want to ${confirmData[confirmType]?.content}`}
                onConfirm={() => handleConfirm(confirmType)}
                onClose={() => setConfirmType(null)}
            />
            <IconButton id="basic-button"
                aria-controls={open ? 'basic-menu' : undefined}
                aria-haspopup="true"
                aria-expanded={open ? 'true' : undefined}
                onClick={handleClick}
                size='small'
            >
                <MoreHorizIcon color='primary' />
            </IconButton>
            <Menu
                id="basic-menu"
                anchorEl={anchorEl}
                open={open}
                onClose={handleClose}
                MenuListProps={{
                    'aria-labelledby': 'basic-button',
                }}
            >
                <MenuItem disabled={true} sx={{ color: 'text.primary', fontWeight: 'medium' }}>{record.email}</MenuItem>
                <MenuItem onClick={() => {
                    redirect(`/admins/${record.id}`);
                }}>Edit</MenuItem>
                <MenuItem onClick={() => handle(record.enabled ? 'disable' : 'enable')}>{record.enabled ? "Disable" : "Enable"}</MenuItem>
                <MenuItem onClick={() => handle('delete')}>Delete</MenuItem>
                <MenuItem
                    disabled={!record.enabled || record.status === 'FORCE_CHANGE_PASSWORD' || record.status === 'RESET_REQUIRED'}
                    onClick={() => handle('reset')}
                >
                    Reset Password
                </MenuItem>
            </Menu>
        </div>
    );
}
