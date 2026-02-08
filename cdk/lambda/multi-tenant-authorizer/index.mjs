import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

/**
 * Multi-tenant Lambda authorizer for API Gateway
 * Validates JWT tokens from multiple Cognito User Pools
 */

// Cache for JWKS clients to avoid repeated requests
const jwksClients = new Map();

/**
 * Get JWKS client for a specific user pool
 */
function getJwksClient(region, userPoolId) {
    const key = `${region}:${userPoolId}`;
    
    if (!jwksClients.has(key)) {
        const client = jwksClient({
            jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
            cache: true,
            cacheMaxEntries: 5,
            cacheMaxAge: 600000, // 10 minutes
        });
        jwksClients.set(key, client);
    }
    
    return jwksClients.get(key);
}

/**
 * Get signing key for JWT verification
 */
function getSigningKey(client, kid) {
    return new Promise((resolve, reject) => {
        client.getSigningKey(kid, (err, key) => {
            if (err) {
                reject(err);
            } else {
                resolve(key.getPublicKey());
            }
        });
    });
}

/**
 * Verify JWT token against a specific user pool
 */
async function verifyToken(token, region, userPoolId, clientId) {
    try {
        // Decode token header to get kid
        const decoded = jwt.decode(token, { complete: true });
        if (!decoded || !decoded.header || !decoded.header.kid) {
            throw new Error('Invalid token structure');
        }

        // Get JWKS client and signing key
        const client = getJwksClient(region, userPoolId);
        const signingKey = await getSigningKey(client, decoded.header.kid);

        // Verify token
        const payload = jwt.verify(token, signingKey, {
            algorithms: ['RS256'],
            audience: clientId,
            issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
        });

        return {
            valid: true,
            payload,
            userPoolId,
            clientId
        };
    } catch (error) {
        console.log(`Token verification failed for pool ${userPoolId}:`, error.message);
        return {
            valid: false,
            error: error.message,
            userPoolId,
            clientId
        };
    }
}

/**
 * Extract tenant ID from various sources
 */
function extractTenantId(event, tokenPayload) {
    // Try to get tenant ID from headers first
    const headers = event.headers || {};
    const tenantIdHeader = headers['x-tenant-id'] || headers['X-Tenant-Id'];
    
    if (tenantIdHeader) {
        return tenantIdHeader;
    }

    // Try to extract from token payload (custom attributes)
    if (tokenPayload && tokenPayload['custom:tenant_id']) {
        return tokenPayload['custom:tenant_id'];
    }

    // Try to extract from username or email domain
    if (tokenPayload && tokenPayload.email) {
        const emailDomain = tokenPayload.email.split('@')[1];
        // This is a fallback - you might want to implement domain-to-tenant mapping
        return emailDomain.split('.')[0]; // Simple extraction, customize as needed
    }

    return null;
}

/**
 * Generate IAM policy for API Gateway
 */
function generatePolicy(principalId, effect, resource, context = {}) {
    const policy = {
        principalId,
        policyDocument: {
            Version: '2012-10-17',
            Statement: [
                {
                    Action: 'execute-api:Invoke',
                    Effect: effect,
                    Resource: resource,
                },
            ],
        },
        context,
    };

    return policy;
}

/**
 * Main Lambda handler
 */
export const handler = async (event) => {
    console.log('Multi-tenant authorizer event:', JSON.stringify(event, null, 2));

    try {
        // Extract token from Authorization header
        const token = event.authorizationToken;
        if (!token) {
            throw new Error('No authorization token provided');
        }

        // Remove 'Bearer ' prefix if present
        const cleanToken = token.replace(/^Bearer\s+/i, '');

        // Get tenant user pools configuration from environment
        const region = process.env.AWS_REGION || 'us-east-1';

        console.log('Available tenants:', tenantsData.length);

        // Try to verify token against all tenant user pools
        const verificationPromises = tenantsData.map(
            (tenant) => {
                return verifyToken(
                    cleanToken,
                    region,
                    tenant.userPoolId,
                    tenant.endUserClientId
                ).then(result => ({
                    ...result,
                    tenantId: tenant.tenantId
                }));
            }
        );

        const verificationResults = await Promise.all(verificationPromises);
        console.log('Verification results:', verificationResults);

        // Find the first valid verification result
        const validResult = verificationResults.find(result => result.valid);

        if (!validResult) {
            console.log('Token verification failed for all user pools');
            throw new Error('Unauthorized');
        }

        console.log(`Token verified successfully for tenant: ${validResult.tenantId}`);

        // Extract additional tenant information
        const tenantId = extractTenantId(event, validResult.payload) || validResult.tenantId;

        // Generate allow policy with context
        const policy = generatePolicy(
            validResult.payload.sub, // Use Cognito user ID as principal
            'Allow',
            event.methodArn,
            {
                tenantId,
                userPoolId: validResult.userPoolId,
                clientId: validResult.clientId,
                username: validResult.payload.username || validResult.payload['cognito:username'],
                email: validResult.payload.email,
                groups: JSON.stringify(validResult.payload['cognito:groups'] || []),
            }
        );

        console.log('Generated policy:', JSON.stringify(policy, null, 2));
        return policy;

    } catch (error) {
        console.error('Authorization error:', error);
        
        // Return deny policy for any errors
        return generatePolicy(
            'unauthorized',
            'Deny',
            event.methodArn,
            {
                error: error.message,
            }
        );
    }
};
