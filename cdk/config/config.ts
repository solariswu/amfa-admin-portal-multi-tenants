// don't change this value. It's different than the one in amfa.
// this is not used in email header/footer.
export const service_name = "amfa";

export const project_name = 'adminportal';
export const current_stage = 'dev';

export const tenant_id = process.env.TENANT_ID;

export const amfa_api_base = process.env.TENANT_ID + '.' + process.env.ROOT_DOMAIN_NAME;

export const suapi_endpoint = 'https://api.su.apersona-id.com/register/'

export const stage_config = {
	dev: {
		env: {
			account: process.env.CDK_DEPLOY_ACCOUNT,
			region: process.env.CDK_DEPLOY_REGION,
		},
		hostedZoneId: process.env.ADMINPORTAL_HOSTED_ZONE_ID,
		domainName: process.env.ADMINPORTAL_DOMAIN_NAME ? process.env.ADMINPORTAL_DOMAIN_NAME : "",
	},
}

export const AMFACONFIG_TABLE = `amfa-${stage_config[current_stage].env.account}-${stage_config[current_stage].env.region}-configtable`;
export const AMFATENANT_TABLE = `amfa-${stage_config[current_stage].env.account}-${stage_config[current_stage].env.region}-tenanttable`;

export const app_userpool_info = {
	needCreate: false,
	userPoolId: process.env.APP_USERPOOL_ID,
}

export const hostedUI_domain_prefix = `${project_name}`;
// export const apps_urls = [process.env.EXTRA_APP_URL ? process.env.EXTRA_APP_URL : ''];

// End User - service providers portal URLs
export const enduser_portal_callbackurls = [`${process.env.SP_PORTAL_URL}/auth-callback`];
export const enduser_portal_logouturls = [`${process.env.SP_PORTAL_URL}`];

// SAML proxy now is one single instance with static domain assigned
// manually deployed
// might change later
export const samlproxy_base_url = 'https://samlproxy.apersona-id.com/';
export const api_samlproxy_base_url = 'https://api.samlproxy.apersona-id.com/'
export const samlproxy_api_url = `${api_samlproxy_base_url}samlproxy`;
export const samlproxy_reload_url = `${api_samlproxy_base_url}reloadsamlproxy`;
export const samlproxy_clean_url = `${api_samlproxy_base_url}clean`;
export const samlproxy_metadata_url = `${samlproxy_base_url}Saml2IDP/proxy.xml`;