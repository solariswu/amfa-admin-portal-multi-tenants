import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { getSecret } from './getKms.mjs';
import * as crypto from 'crypto';

const aesDecrypt = ({ toDecrypt, aesKey }) => {
    const decipher = crypto.createDecipheriv('aes-128-ecb', aesKey, '');
    let decrypted = decipher.update(toDecrypt, 'base64', 'utf8');
    return decrypted + decipher.final('utf8');
};

const readFromDB = async (email, provider_id, tenant_id, dynamodb) => {
    //fetch tenant Info
    const params = {
        TableName: process.env.TOTPTOKEN_TABLE + tenant_id,
        Key: {
            id: { S: email.trim() + '#' + provider_id?.trim() },
        },
    };

    const result = await dynamodb.send(new GetItemCommand(params));

    console.log('get totp token result', result);

    const item = result.Item;

    if (item && item.token) {

        return {
            token: item.token.S,
            device_name: item.device_name.S,
            email,
        };
    }

    return null;
}


export const getSecretKey = async (payload, dynamodb) => {
    const { email, pid, tid} = payload;

    const readResult = await readFromDB(email, pid, tid, dynamodb);

    console.log('totpTokenDB readResult', readResult);

    if (readResult) {
        const result = readResult.token;

        const secret = await getSecret();
        const totp_secret = secret?.Mobile_Token_Key;
        const totp_salt = secret?.Mobile_Token_Salt;

        const key_and_salt = `${totp_secret}${totp_salt}`;
        const key_salt_and_email = key_and_salt + email.substring(0, email.length / 2);
        const encoded_key = Buffer.from(key_salt_and_email, 'utf8').toString('base64');
        const final_encrypt_key = encoded_key.substring(0, 16);

        return aesDecrypt({ toDecrypt: result, aesKey: final_encrypt_key });

    }

    return null;

}

export const getTotp = async (email, provider_id, tenant_id, dynamodb) => {
	const res = await readFromDB(email, provider_id, tenant_id, dynamodb);
	return res?.device_name;
}

export const getResData = async (payload, dynamodb, getType) => {

    switch (getType) {
        case 'n':
            //device name only
            return await getTotp(payload.email, payload.pid, payload.tid, dynamodb);
        case 'c':
            return await readFromDB(payload.email, payload.pid, payload.tid, dynamodb)
            // return await getSecretKey(payload, dynamodb);
        default:
            break;
    }

    return null;

}