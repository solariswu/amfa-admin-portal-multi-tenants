import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

/**
 * TenantContext provides the currently selected tenant across the admin portal.
 * 
 * This is a pure React context with NO react-admin dependencies.
 * Permission-based auto-initialization (e.g., for TA users) is handled
 * by TenantContextInitializer which lives inside the <Admin> tree.
 * 
 * Behavior per role:
 * - SA (Super Admin): Starts with no tenant selected; user picks from all tenants via TenantSelector
 * - SPA (Service Provider Admin): Starts with no tenant selected; user picks from their org's tenants
 * - TA (Tenant Admin): Auto-populated by TenantContextInitializer
 */
const TenantContext = createContext({
  selectedTenantId: null,
  selectedTenantName: null,
  setSelectedTenant: () => {},
  clearSelectedTenant: () => {},
  isTenantSelected: false,
});

export const TenantContextProvider = ({ children }) => {
  const [selectedTenantId, setSelectedTenantId] = useState(() => {
    // Restore from sessionStorage on mount
    const stored = sessionStorage.getItem('selectedTenant');
    if (stored) {
      try {
        return JSON.parse(stored).id || null;
      } catch {
        return null;
      }
    }
    return null;
  });

  const [selectedTenantName, setSelectedTenantName] = useState(() => {
    const stored = sessionStorage.getItem('selectedTenant');
    if (stored) {
      try {
        return JSON.parse(stored).name || null;
      } catch {
        return null;
      }
    }
    return null;
  });

  const setSelectedTenant = useCallback((id, name) => {
    setSelectedTenantId(id);
    setSelectedTenantName(name || null);
    if (id) {
      sessionStorage.setItem('selectedTenant', JSON.stringify({ id, name }));
    } else {
      sessionStorage.removeItem('selectedTenant');
    }
  }, []);

  const clearSelectedTenant = useCallback(() => {
    setSelectedTenantId(null);
    setSelectedTenantName(null);
    sessionStorage.removeItem('selectedTenant');
  }, []);

  const value = {
    selectedTenantId,
    selectedTenantName,
    setSelectedTenant,
    clearSelectedTenant,
    isTenantSelected: !!selectedTenantId,
  };

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
};

/**
 * Hook to access the current tenant context
 */
export const useTenantContext = () => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenantContext must be used within a TenantContextProvider');
  }
  return context;
};

export default TenantContext;