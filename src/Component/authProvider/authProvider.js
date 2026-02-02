import { UserManager } from "oidc-client";

import { getProfileFromToken } from "./getProfileFromToken";
import { getRoleType, getOrgId, getTenantId } from "../../utils/roleUtils";

import awsExports from "../../aws-export";

const issuer = `https://cognito-idp.${awsExports.aws_project_region}.amazonaws.com/${awsExports.aws_user_pools_id}`;
const clientId = awsExports.aws_user_pools_web_client_id;
const redirectUri = `${window.location.protocol}//${window.location.host}/auth-callback`;
const oauth2Url = awsExports.aws_hosted_ui_url;
const logoutUri = `${window.location.protocol}//${window.location.host}`;

let logoutPromise = null;

const userManager = new UserManager({
  authority: issuer,
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "openid email profile", // Allow to retrieve the email and user name later api side
});

const cleanup = () => {
  // Remove the ?code&state from the URL
  window.history.replaceState(
    {},
    window.document.title,
    window.location.origin
  );
};

const authProvider = {
  login: async () => {
    // 1. Redirect to the issuer to ask authentication
    await userManager.signinRedirect();
    return; // Do not return anything, the login is still loading
  },
  logout: async () => {
    // console.log('logout')
    // Remove the token from the local storage
    // if (localStorage.getItem('token')) {
    //   localStorage.removeItem('token');
    //   // console.log('logout url', `${oauth2Url}/logout?client_id=${clientId}&logout_uri=${logoutUri}`)
    //   // 2. Redirect to the issuer to ask logout
    //   window.location.href = `${oauth2Url}/logout?client_id=${clientId}&logout_uri=${logoutUri}`;
    // }
    // // return Promise.resolve({ redirectTo: '/login' });
    // return ;
    // // console.log ('logout promise', logoutPromise)

    if (!logoutPromise) {
      // console.log('logout promise null')
      if (localStorage.getItem('token')) {
        // console.log ('got token', localStorage.getItem('token'))
        logoutPromise = new Promise(async (resolve, reject) => {
          try {
            localStorage.removeItem('token');
            // console.log('logout token removed')
            // await userManager.signoutRedirect();
            window.location.href = `${oauth2Url}/logout?client_id=${clientId}&logout_uri=${logoutUri}`;
            return resolve();
          } catch (error) {
            // console.log('logout error', error)
            return reject({
              redirectTo: false,
              message: error.message,
            });
          }
        });
      }
      else {
        // console.log('logout no token')
        logoutPromise = Promise.resolve();
        // return '/login'
        // await userManager.signoutRedirect();
        // logoutPromise =  new Promise(async (resolve, reject) => {
        //   return reject({
        //     redirectTo: '/login',
        //     message: '',
        //   });
        // });
        // cleanup();
        return logoutPromise;
      }
    }
    return '/login';
  },
  checkError: () => {
    // console.log('checkError')
    // localStorage.removeItem("token");
    return Promise.resolve();
  },
  checkAuth: () => {
    const tokenStr = localStorage.getItem('token');

    if (!tokenStr || tokenStr.length === 0) {
      return Promise.reject();
    }

    // console.log('check tokenStr', tokenStr)

    const jwt = getProfileFromToken(tokenStr);
    const now = new Date();
    // console.log('jwt.exp', jwt.exp)
    // console.log('now:', now.getTime(), 'jwt expired at:', jwt.exp * 1000, 'jwt expired:', now.getTime() > jwt.exp * 1000)

    return (now.getTime() > jwt.exp * 1000)
      ? Promise.reject()
      : Promise.resolve();
  },
  getPermissions: () => {
    const token = localStorage.getItem('token');
    if (!token) {
      return Promise.reject(new Error('No token found'));
    }
    
    try {
      const profile = getProfileFromToken(token);
      const groups = profile['cognito:groups'] || [];
      
      // Extract role information
      const roleType = getRoleType(groups);
      const orgId = getOrgId(groups);
      const tenantId = getTenantId(groups);
      
      const permissions = {
        roles: groups,
        roleType: roleType,
        orgId: orgId,
        tenantId: tenantId,
        // Convenience flags for quick checks
        isSA: groups.includes('SA'),
        isSPA: groups.some(g => g.startsWith('SPA_')),
        isTA: groups.some(g => g.startsWith('TA_'))
      };
      
      console.log('Permissions loaded:', permissions);
      return Promise.resolve(permissions);
    } catch (error) {
      console.error('Failed to get permissions:', error);
      return Promise.reject(error);
    }
  },
  getIdentity: () => {
    const token = localStorage.getItem('token');
    if (!token || token.length === 0) {
      return Promise.reject();
    }

    const profile = getProfileFromToken(token);

    return Promise.resolve({
      id: profile.sub,
      fullName: profile.given_name ? profile.given_name : profile.email,//profile.given_name + ' ' + profile.family_name,
      avatar: profile.picture,
      email: profile.email,
    });
  },
  handleCallback: async () => {
    // We came back from the issuer with ?code infos in query params
    const { searchParams } = new URL(window.location.href);
    // console.log('handlecallback - searchParams', searchParams)
    // console.log('handlecallback - window.location.href', window.location.href)
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    // console.log('handlecallback - code', code, 'state', state)

    if (!code || !state) {
      return Promise.resolve()
    }

    // We need to remove the ?code&state from the URL')

    // oidc-client uses localStorage to keep a temporary state
    // between the two redirections. But since we need to send it to the API
    // we have to retrieve it manually
    const stateKey = `oidc.${state}`;
    const { code_verifier } = JSON.parse(
      localStorage.getItem(stateKey) || "{}"
    );

    // Transform the code to a token via the API
    const params = {
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code: code,
      code_verifier
    };

    // console.log ('fetching from', `${oauth2Url}/oauth2/token`)
    // console.log('params', params)

    let body = Object.keys(params)
      .map((key) => { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); })
      .join('&');
    const response = await fetch(`${oauth2Url}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    // console.log('get token response', response)

    if (!response.ok) {
      cleanup();
      return Promise.reject();
    }

    const token = await response.json();
    // console.log('get token', token)

    localStorage.setItem('token', token.id_token);
    // console.log('token has been set', localStorage.getItem('token'))

    userManager.clearStaleState();
    cleanup();
    return Promise.resolve();
  },
};

export default authProvider;
