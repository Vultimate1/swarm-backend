/*require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());

const storage = multer.memoryStorage();
const upload = multer({ storage });
//const upload = multer({ dest: "uploads/" });
app.get("/", (req, res) => {
  res.send("Backend is running");
});
app.post("/send-email", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded");

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: "File from site",
      text: "Attached file",
      attachments: [
        {
          filename: req.file.originalname,
          content: req.file.buffer
        }
      ]
    });

    res.send("Email sent!");
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).send({ error: err.message });
  }
});

app.listen(process.env.PORT || 5000, () => {
  console.log("Server running");
});*/




const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { ConfidentialClientApplication } = require('@azure/msal-node');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const TENANT_ID = process.env.AZURE_TENANT_ID;
const OUTLOOK_EMAIL = process.env.OUTLOOK_EMAIL;
const REDIRECT_URI = 'https://swarm-backend-ga0y.onrender.com/auth/callback';

const cachePlugin = {
  beforeCacheAccess: async (cacheContext) => {
    if (fs.existsSync(TOKEN_PATH)) {
       cacheContext.tokenCache.deserialize(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    }
  },
  afterCacheAccess: async (cacheContext) => {
    if (cacheContext.cacheHasChanged) {
       fs.writeFileSync(TOKEN_PATH, cacheContext.tokenCache.serialize());
    }
  },
};

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
  },
  cache: { cachePlugin },
});

// Store token in memory
let cachedToken = null;

app.get('/', (req, res) => res.send('Backend is running'));

async function getAccessToken() {
  const result = await msalClient.getTokenCache().getAllAccounts();
  if (accounts.length === 0) return null;

  try {
    const result = await msalClient.acquireTokenSilent({
      account: accounts[0],
      scopes: ['Mail.send'],
    });
    return result.accessToken;
  } catch (err) {
    console.error('Silent token refresh failed:', err.message);
    return null;
  }
}

app.get('/', (req, res) => res.send('Backend is running'));

app.get('/auth', async (req, res) => {
  try {
    const url = await msalClient.getAuthCodeUrl({
      scopes: ['Mail.Send', 'offline_access'],
      redirectUri: REDIRECT_URI,
    });
    console.log('Redirecting to:', url);
    res.redirect(url);
  } catch (err) {
    console.error('Auth URL error:', err);
    res.status(500).send('Failed to generate auth URL: ' + err.message);
  }
});

app.get('/auth/callback', async (req, res) => {
  const {code} = req.query;
  try {
    const result = await msalClient.acquireTokenByCode({
      scopes: ['Mail.Send'],
      redirectUrl: REDIRECT_URI,
    });
    cachedToken = result.accessToken;
    res.send('Auth successful! You can now send emails.');
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).send('Auth failed: ' + err.message);
  }
});

app.post('/send-email', async (req, res) => {
  if (!cachedToken) {
    return res.status(401).json({ error: 'Not authenticated. Visit /auth first.' });
  }

  const { to, subject, text, html } = req.body;
  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const message = {
      message: {
        subject,
        body: {
          contentType: html ? 'HTML' : 'Text',
          content: html || text,
        },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    };

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${OUTLOOK_EMAIL}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cachedToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      }
    );

    if (response.status === 202) {
      res.json({ success: true });
    } else {
      const error = await response.json();
      res.status(500).json({ error: error.error?.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));