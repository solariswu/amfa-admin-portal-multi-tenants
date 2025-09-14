import {
	AdminCreateUserCommand,
	AdminAddUserToGroupCommand,
	AdminLinkProviderForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const assignApplications = async (groups, username, cognitoISP) => {
	return Promise.all(groups.map((group) =>
		cognitoISP.send(new AdminAddUserToGroupCommand({
			UserPoolId: process.env.USERPOOL_ID,
			GroupName: group,
			Username: username
		}))))
}

function getRandomUpper() {
    return String.fromCharCode(Math.floor(Math.random() * 26) + 65)
}

function getRandomLower() {
    return String.fromCharCode(Math.floor(Math.random() * 26) + 97)
}

function getRandomNumber() {
    return String.fromCharCode(Math.floor(Math.random() * 10) + 48)
}

function getRandomSymbol() {
    const symbols = '!@#$%^&*(){}[]=<>/,.'
    return symbols[Math.floor(Math.random() * symbols.length)]
}

const  randomFunc = {
    upper: getRandomUpper,
    lower: getRandomLower,
    number: getRandomNumber,
    symbol: getRandomSymbol
};


function generatePassword(lower, upper, number, symbol, length) {
    console.log(lower, upper, number, symbol, length)
    let generatedPassword = ''
    const typesCount = lower + upper + number + symbol
   //Object.values(item)[0] 获取数组中每个对象的值  
   // 筛选出值为true(状态为选中的)的大写英文字母、小写英文字母、数字、特殊符号
    const typesArr = [{lower}, {upper}, {number}, {symbol}].filter(item => Object.values(item)[0] )
    // 状态都为未选中，则都为flase，加起来就是0；直接返回
    if(typesCount === 0) {
        return false
    }

    for(let i = 0; i < length; i +=  typesCount) {
        // 遍历循环状态为选中的对象组成的数组，获取每个对象的属性名，根据属性名调用各自生成函数
        typesArr.forEach(type => {
            const funcName = Object.keys(type)[0]
            generatedPassword += randomFunc[funcName]()
        })
    }
    // 截取选择的密码位数长度的随机密码
    const finalPassword = generatedPassword.slice(0, length)
    return finalPassword
}

export const postResData = async (data, cognitoISP) => {
	console.log('postResData Input:', data);
	const groups = [];
	const attributes = [];
	Object.keys(data).map(key => {
		switch (key.toLowerCase()) {
			case 'locale':
			case 'profile':
			case 'given_name':
			case 'family_name':
			case 'name':
			case 'middle_name':
			case 'picture':
			case 'profile':
			case 'gender':
			case 'birthdate':
			// case 'address':
				if (data[key]) {
					attributes.push({ "Name": key.toLowerCase(), "Value": data[key] });
				}
				break;
			case 'email':
				if (data[key]) {
					attributes.push({ "Name": key.toLowerCase(), "Value": data[key].toLowerCase() });
					attributes.push({ "Name": 'email_verified', "Value": 'true' });
				}
				break;
			case 'phone_number':
				if (data[key]) {
					attributes.push({ "Name": key.toLowerCase(), "Value": data[key] });
					attributes.push({ "Name": 'phone_number_verified', "Value": 'true' });
				}
				break;
			// case 'email_verified':
			case 'phone_number_verified':
				if (data[key]) {
					attributes.push({ "Name": key.toLowerCase(), "Value": data[key] ? 'true' : 'false' });
				}
				break;
			case 'groups':
				groups.push(...data[key]);
				break;
			case 'alter-email':
			case 'voice-number':
				if (data[key]) {
					attributes.push({ "Name": `custom:${key}`, "Value": data[key] });
				}
				break;
			default:
				break;
		}
		return key;
	});

	// to allow using email login, amfa has to set user email to verified
	attributes.push({ "Name": 'email_verified', "Value": 'true' });

	attributes.push({ "Name": 'nickname', "Value": data['given_name'] + ' ' + data['family_name'] });

	const params = {
		Username: data['email'].replace('@', '_').replace('.', '_').toLowerCase(),
		...(!data.notify && { MessageAction: 'SUPPRESS' }),
		TemporaryPassword: generatePassword(true, true, true, true, 10),//data.password,
		UserAttributes: attributes,
		UserPoolId: process.env.USERPOOL_ID,
		DesiredDeliveryMediums: ['EMAIL'],
	}

	const resData = await cognitoISP.send(new AdminCreateUserCommand(params));
	const item = resData.User;

	if (item) {

		if (groups && groups.length > 0) {
			try {
				await assignApplications(groups, item.Username, cognitoISP);
			}
			catch (err) {
				console.log('create user - assignApplications/groups Error:', err);
			}
		}

		try {
			await cognitoISP.send(new AdminLinkProviderForUserCommand({
				UserPoolId: process.env.USERPOOL_ID,
				DestinationUser: {
					ProviderName: 'Cognito',
					ProviderAttributeName: 'email',
					ProviderAttributeValue: data['email'].toLowerCase(),
				},
				SourceUser: {
					ProviderName: 'apersona',
					ProviderAttributeName: 'email',
					ProviderAttributeValue: data['email'].toLowerCase(),
				}
			}))
		}
		catch (err) {
			console.log('create user - AdminLinkProviderForUser Error:', err);
		}

		const email_verified = item.Attributes.find(attr => attr.Name === "email_verified")?.Value;
		const phone_number_verified = item.Attributes.find(attr => attr.Name === "phone_number_verified")?.Value;

		const directMappingArrtibutes = [
			'email', 'phone_number', 'locale', 'sub', 'profile', 'given_name', 'family_name',
			'nickname', 'name', 'middle_name', 'picture', 'profile', 'gender', 'birthdate'/*, 'address'*/];
		const filteredAttributs = item.Attributes.filter(el => directMappingArrtibutes.includes(el.Name));
		const result = Object.fromEntries(filteredAttributs.map(el => [el.Name, el.Value]))

		return {
			id: item.Username,
			username: item.Username,
			enabled: item.Enabled,
			status: item.UserStatus,
			email_verified: email_verified === 'true' ? true : false,
			phone_number_verified: phone_number_verified === 'true' ? true : false,
			groups: groups ? groups : null,
			...result,
		}
	}
}

export default postResData;