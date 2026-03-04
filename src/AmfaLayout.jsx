import { Layout } from 'react-admin';

import { AmfaAppBar } from './AmfaAppBar';
import { AmfaMenu } from './AmfaMenu';
import { TenantContextInitializer } from './Component/TenantContextInitializer';

/**
 * Custom Layout that includes the TenantContextInitializer.
 * 
 * TenantContextInitializer runs inside the <Admin> tree so it can
 * access usePermissions() and auto-set tenant context for TA users.
 */
export const AmfaLayout = (props) => (
  <>
    <TenantContextInitializer />
    <Layout {...props} appBar={AmfaAppBar} menu={AmfaMenu} />
  </>
);