import { useState, useEffect } from 'react';
import { Menu, usePermissions } from 'react-admin';
import PeopleIcon from '@mui/icons-material/People';
import GroupIcon from '@mui/icons-material/Group';
import PublishIcon from '@mui/icons-material/Publish';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import SettingsIcon from '@mui/icons-material/Settings';
import BusinessIcon from '@mui/icons-material/Business';
import PaletteIcon from '@mui/icons-material/Palette';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import ApartmentIcon from '@mui/icons-material/Apartment';

/**
 * Custom Menu component with role-based visibility.
 * 
 * - "Tenants" menu item is only visible for SA and SPA users.
 * - Other menu items follow existing visibility patterns.
 */
export const AmfaMenu = () => {
  const { permissions, isLoading } = usePermissions();

  const isSAOrSPA = permissions?.isSA || permissions?.isSPA;

  return (
    <Menu>
      <Menu.ResourceItem name="users" />
      <Menu.ResourceItem name="importusers" />
      <Menu.ResourceItem name="groups" />
      <Menu.ResourceItem name="appclients" />
      <Menu.ResourceItem name="samls" />
      <Menu.ResourceItem name="organizations" />
      {isSAOrSPA && <Menu.ResourceItem name="tenants" />}
      <Menu.ResourceItem name="brandings" />
      <Menu.ResourceItem name="admins" />
    </Menu>
  );
};