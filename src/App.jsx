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
import brandings from "./brandings";
import admins from "./admins";

import authProvider from "./Component/authProvider/authProvider";
import LoginPage from "./Component/authProvider/LoginPage";

import { AmfaLayout } from "./AmfaLayout";

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
  en: englishMessages
};

const i18nProvider = polyglotI18nProvider(locale => messages[locale], "en", {
  allowMissing: true
});
export const App = () => (
  <>
    <Favicon url="/favicon.ico" />
  <BrowserRouter>
    <Admin
      theme={theme}
      disableTelemetry
      authProvider={authProvider}
      dataProvider={dataProvider}
      loginPage={LoginPage}
      layout={AmfaLayout}
      locale="en"  // Add this...
      i18nProvider={i18nProvider}
      requireAuth={true}
      >
      <Resource name="users" {...users} />
      <Resource options={{ label: 'User Import' }} name="importusers" {...importuser} />
      <Resource options={{ label: 'User Groups' }} name="groups" {...groups} />
      <Resource options={{ label: 'Service Providers' }} name="appclients" {...appclients} />
      <Resource options={{ label: 'Service Providers' }} name="samls" {...samls} />
      <Resource options={{ label: 'Settings' }} name="tenants" {...tenants} />
      <Resource options={{ label: 'Brandings'}} name="brandings" {...brandings} />
      <Resource options={{ label: 'Admin'}} name="admin" {...admins} />
      {/* <CustomRoutes>
        <Route path="/user/import" element={<UserImport />} />
      </CustomRoutes> */}
    </Admin>
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