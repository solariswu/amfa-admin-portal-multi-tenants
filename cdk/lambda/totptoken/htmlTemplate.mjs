const HTML_TEMPLATE = (user, types, values, logoUrl, serviceName, isByAdmin) => {
	let diff = `<p>Your following MFA value${types.length > 1 ? 's' : ''} has been changed${isByAdmin ? ' by Admin' : ''}.</p>`;

	for (let index = 0; index < types.length; index++) {
		diff += `<p>&nbsp;&nbsp;&#x2022; ${types[index]} has been `;
		diff += values[index] && values[index].length > 1 ? 'changed to ' + values[index] : 'removed';
		diff += '</p>';
	}

	console.log('HTML template diff value', diff);

	return `
		<!DOCTYPE html >
			<html>
				<head>
					<meta charset="utf-8">
						<title>Email Title</title>
						<style>
							.container {
								width: 95%;
								box-shadow: 0 0.5em 1em 0 rgba(0,0,0,0.2);
								margin: 2em auto;
								border-radius: 0.5em;

							}
							.email {
								padding: 1em 4em;
							}
							.email-body {
								padding-top: 0.5em;
							}
							.email-footer {
								text-align: center;
							}
							.logo {
								text-align: center;
							}
							img {
								height: 57px;
								width: 313px;
							}
						</style>
				</head>
				<body>
					<div class="container">
						<div class="logo">
							<img src="${logoUrl}" alt="logo" />
						</div>
						<div class="email">
							<div>
								<h1>MFA value changed</h1>
							</div>
							<div class="email-body">
								<p>Hello ${user},</p>
								${diff}
								<p>If you did not make this change, please contact the help desk.</p>
							</div>
							<div class="email-footer">
								<p>${serviceName}</p>
							</div>
						</div>
					</div>
				</body>
			</html>
	`;
}

export default HTML_TEMPLATE;