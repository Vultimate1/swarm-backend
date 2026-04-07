const { ConfidentialClientApplication } = require('@azure/msal-node');

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: 'df9d311a-5c45-4b91-850e-309b01b0dc0f',
    clientSecret: '0BS8Q~ayARcTpF1er4dr4zq~MlHhNZpZqLjUWa.r',
    authority: 'https://login.microsoftonline.com/4c25b8a6-17f7-46f9-83f0-54734ab81fb1',
  },
});

msalClient.acquireTokenByClientCredential({
  scopes: ['https://graph.microsoft.com/.default'],
})
.then(result => console.log('✅ Token acquired! OAuth is working:', result.accessToken))
.catch(err => console.error('❌ OAuth failed:', err.errorMessage));