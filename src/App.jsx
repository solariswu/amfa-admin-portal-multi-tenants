import * as React from "react";
import { BrowserRouter } from 'react-router-dom';

import { Admin, Resource } from 'react-admin';
import dataProvider from './Component/dataProvider'
import polyglotI18nProvider from "ra-i18n-polyglot";
import englishMessages from "ra-language-english";
import Favicon from 'react-favicon'

import users from './users';
import groups from "./applications";
import appclients from "./appclients";
import samls from "./samls";
import importuser from './importusers';
import tenants from "./tenants";
import organizations from "./organizations";
import brandings from "./brandings";
import settings from "./settings";
import smtp from "./smtp";
import admins from "./admins";

import authProvider from "./Component/authProvider/authProvider";
import LoginPage from "./Component/authProvider/LoginPage";

import { AmfaLayout } from "./AmfaLayout";
import { TenantContextProvider } from "./contexts/TenantContext";
import { AmfaDashboard } from "./Component/SelectTenantPrompt";

import { defaultTheme } from 'react-admin';

const theme = {
  ...defaultTheme,
  components: {
    ...defaultTheme.components,
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
      },
    },
    MuiFormControl: {
      defaultProps: {
        variant: 'outlined',
      },
    },
    RaDatagrid: {
      styleOverrides: {
        root: {
          "& .RaDatagrid-headerCell": {
            fontWeight: "bold",
          },
        }
      }
    },
  }
};

const messages = {
  en: {
    ...englishMessages,
    resources: {
      organizations: {
        name: 'IT Svc Org |||| IT Svc Orgs',
        fields: {
          id: 'IT Svc Org ID',
          name: 'Name',
          description: 'Description',
          created_by: 'Created By',
          created_at: 'Created At',
        },
      },
    },
  },
};

const i18nProvider = polyglotI18nProvider(locale => messages[locale], "en", {
  allowMissing: true
});
export const App = () => (
  <>
    <Favicon url="/favicon.ico" />
    <BrowserRouter>
      <TenantContextProvider>
      <Admin
        theme={theme}
        disableTelemetry
        authProvider={authProvider}
        dataProvider={dataProvider}
        loginPage={LoginPage}
        layout={AmfaLayout}
        dashboard={AmfaDashboard}
        locale="en"
        i18nProvider={i18nProvider}
        requireAuth={true}
      >
        <Resource options={{ label: 'IT Svc Orgs' }} name="organizations" {...organizations} />
        <Resource options={{ label: 'Tenants' }} name="tenants" {...tenants} />
        <Resource name="users" {...users} />
        <Resource options={{ label: 'User Import' }} name="importusers" {...importuser} />
        <Resource options={{ label: 'User Groups' }} name="groups" {...groups} />
        <Resource name="admins" {...admins} />
        <Resource name="brandings" {...brandings} />
        <Resource name="settings" {...settings} />
        <Resource options={{ label: 'SMTP' }} name="smtp" {...smtp} />
        <Resource options={{ label: 'Service Providers' }} name="appclients" {...appclients} />
        {/* <Resource options={{ label: 'Service Providers' }} name="samls" {...samls} /> */}
        {/* <CustomRoutes>
        <Route path="/user/import" element={<UserImport />} />
      </CustomRoutes> */}
      </Admin>
      </TenantContextProvider>
    </BrowserRouter>
    <div style={{
      position: 'fixed', right: 0, bottom: 0, left: 0, zIndex: 100,
      padding: 6,
      backgroundColor: 'white',
      textAlign: 'center',
      color: "grey",
      fontSize: "11px",
    }}>Copyright &copy; 2025 aPersona Inc. v1.1.0</div>
  </>
);
