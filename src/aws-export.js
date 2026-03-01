/* eslint-disable */

// import { AdminHostedUIURL, AdminPortalClientId, AdminPortalUserPoolId, ProjectRegion, AdminPortalDomainName } from "/amfaext.js";
export const AdminPortalUserPoolId="us-east-1_4lHCLz1bE"
export const AdminPortalClientId="5d27k9lkshkmrquvo5jok6219k"
export const AdminHostedUIURL="https://adminportal-jlriby.auth.us-east-1.amazoncognito.com"
export const ProjectRegion='us-east-1'
export const AdminPortalDomainName='adminportal.amfa7.aws-amplify.dev'


const awsmobile = {
	aws_project_region: ProjectRegion,
	aws_backend_api_url: `https://api.${AdminPortalDomainName}`,
	aws_samlproxy_api_url: 'https://api.samlproxy.apersona-id.com/samlproxy',
	aws_user_pools_id: AdminPortalUserPoolId,  // admin userpool id
	aws_user_pools_web_client_id: AdminPortalClientId,
	aws_hosted_ui_url: AdminHostedUIURL
};
export default awsmobile;
