import { getSMTP, setSMTP } from './kmsUtil.mjs';
import { validateTenantAccess, getTenantIdFromRequest, createResponse } from 'admin-auth';

export const handler = async (event) => {

    console.info("EVENT\n" + JSON.stringify(event, null, 2))
    console.log('event.requestContext.http.method: ', event.requestContext.http.method);

    // 1. Extract tenant_id from request
    const tenantId = getTenantIdFromRequest(event);
    
    if (!tenantId) {
        return createResponse(400, { error: 'tenant_id required in request' });
    }

    // 2. Validate authorization
    const authResult = await validateTenantAccess(event, tenantId);
    
    if (!authResult.authorized) {
        return createResponse(authResult.statusCode, { error: authResult.error });
    }
    
    console.log(`Authorized access for tenant ${tenantId}, role: ${authResult.role}`);

    const testSMTP = async (secret) => {
        const nodemailer = require("nodemailer");
        const transporter = nodemailer.createTransporter({
            host: secret.host,
            port: secret.port,
            secure: secret.secure === 'true' || (secret.secure ? secret.secure : false),
            auth: {
                user: secret.user,
                pass: secret.pass,
            },
        });

        console.log('smtp test transporter:', {
            host: secret.host,
            port: secret.port,
            secure: secret.secure === 'true' || (secret.secure ? secret.secure : false),
            auth: {
                user: secret.user,
                pass: secret.pass,
            },
        });
        try {
            // send mail with defined transport object
            const info = await transporter.sendMail({
                from: secret.user, // sender address
                to: secret.toUser, // list of receivers
                subject: "aPersona Identity Tenant SMTP Email Settings Test", // Subject line
                text: "This is a test email generated to confirm your aPersona Identity SMTP email service settings. \nIf you have received this email, your settings are working correctly.", // plain text body
                html: "<p>This is a test email generated to confirm your aPersona Identity SMTP email service settings.</p><p>If you have received this email, your settings are working correctly.</p>", // html body
            });

            console.log("Message sent: %s", info.messageId);

            return createResponse(200, { data: 'OK' });
        } catch (error) {
            console.log('smtp test error message:', error.message);
            console.log('smtp test error stack:', error.stack);
            return createResponse(500, { data: error.message ? error.message : 'message not sent' });
        }
    }

    try {
        switch (event.requestContext.http.method) {
            case 'GET':
                const getResult = await getSMTP(tenantId);
                return createResponse(200, { data: getResult });
            case 'PUT':
				const payload = JSON.parse(event.body);
				const putResult = await setSMTP(tenantId, payload.data);
				return createResponse(200, { data: putResult });
            case 'POST':
				const body = JSON.parse(event.body);
				return await testSMTP(body.data);
            case 'OPTIONS':
                return createResponse(200, { data: 'ok' });
            default:
                return createResponse(404, { data: 'Not Found' });
        }
    }
    catch (e) {
        console.log('Catch an error: ', e)
        return createResponse(500, { type: 'exception', message: 'Service Error' });
    }
}
