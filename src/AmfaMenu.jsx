import { Menu, usePermissions } from 'react-admin';

/**
 * Custom Menu component with role-based visibility.
 * 
 * - "Tenants" menu item is only visible for SA and SPA users.
 * - Other menu items follow existing visibility patterns.
 */
export const AmfaMenu = () => {
  const { permissions } = usePermissions();

  const isSAOrSPA = permissions?.isSA || permissions?.isSPA;
  const isSA = permissions?.isSA;

  return (
    <Menu>
      {isSA && <Menu.ResourceItem name="organizations" />}
      {isSAOrSPA && <Menu.ResourceItem name="tenants" />}
      <Menu.ResourceItem name="admins" />
      <Menu.ResourceItem name="users" />
      <Menu.ResourceItem name="importusers" />
      <Menu.ResourceItem name="groups" />
      {/* <Menu.ResourceItem name="samls" /> */}
      <Menu.ResourceItem name="brandings" />
      <Menu.ResourceItem name="appclients" />
    </Menu>
  );
};