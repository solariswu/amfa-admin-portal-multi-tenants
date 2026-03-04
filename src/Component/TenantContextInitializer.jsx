import { useEffect } from 'react';
import { usePermissions } from 'react-admin';
import { useTenantContext } from '../contexts/TenantContext';

/**
 * TenantContextInitializer
 * 
 * This component lives inside the <Admin> tree (via the layout) so it can
 * access react-admin hooks (usePermissions). It auto-sets the tenant context
 * for TA users based on their JWT permissions.
 * 
 * For SA/SPA users, the tenant selection is manual via TenantSelector.
 * 
 * Renders nothing — it's a side-effect-only component.
 */
export const TenantContextInitializer = () => {
  const { permissions, isLoading } = usePermissions();
  const { selectedTenantId, setSelectedTenant } = useTenantContext();

  useEffect(() => {
    if (!isLoading && permissions?.isTA && permissions?.tenantId && !selectedTenantId) {
      setSelectedTenant(permissions.tenantId, null);
    }
  }, [isLoading, permissions, selectedTenantId, setSelectedTenant]);

  // Clear tenant selection on logout (permissions become null)
  useEffect(() => {
    if (!isLoading && !permissions) {
      sessionStorage.removeItem('selectedTenant');
    }
  }, [isLoading, permissions]);

  return null;
};

export default TenantContextInitializer;