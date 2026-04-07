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
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const upload = multer();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const TENANT_ID = process.env.AZURE_TENANT_ID;
const OUTLOOK_EMAIL = process.env.OUTLOOK_EMAIL;
const REDIRECT_URI = 'https://swarm-backend-ga0y.onrender.com/auth/callback';
const TOKEN_PATH = path.join(__dirname, 'token_cache.json');

// Load token from disk if exists
let tokenData = null;
if (fs.existsSync(TOKEN_PATH)) {
  try {
    tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    console.log('Loaded token from cache');
  } catch (e) {
    console.log('No valid token cache found');
  }
}

// Save token to disk
function saveToken(data) {
  tokenData = data;
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(data));
}

// Refresh access token using refresh token
async function refreshAccessToken() {
  if (!tokenData?.refresh_token) return null;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: tokenData.refresh_token,
    grant_type: 'refresh_token',
    scope: 'https://graph.microsoft.com/Mail.Send offline_access',
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    }
  );

  const data = await response.json();
  if (data.access_token) {
    saveToken(data);
    console.log('Token refreshed successfully');
    return data.access_token;
  }
  console.error('Token refresh failed:', data);
  return null;
}

// Get valid access token
async function getAccessToken() {
  if (!tokenData) return null;

  // Check if token is expired (with 5 min buffer)
  const expiresAt = tokenData.expires_at || 0;
  if (Date.now() < expiresAt - 300000) {
    return tokenData.access_token;
  }

  // Refresh if expired
  return await refreshAccessToken();
}

app.get('/', (req, res) => res.send('Backend is running'));

// Step 1: Redirect to Microsoft login
app.get('/auth', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Files.ReadWrite offline_access',
    response_mode: 'query',
  });

  const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${params}`;
  console.log('Redirecting to Microsoft login');
  res.redirect(authUrl);
});

// Step 2: Handle callback
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`Auth error: ${error} - ${req.query.error_description}`);
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Files.ReadWrite offline_access'
  });

  try {
    const response = await fetch(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      }
    );

    const data = await response.json();
    if (data.access_token) {
      // Store expiry time
      data.expires_at = Date.now() + data.expires_in * 1000;
      saveToken(data);
      res.send('✅ Auth successful! You can now send emails.');
    } else {
      console.error('Token error:', data);
      res.status(500).send(`Token error: ${data.error_description}`);
    }
  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).send('Auth failed: ' + err.message);
  }
});

// Check auth status
app.get('/auth/status', async (req, res) => {
  const token = await getAccessToken();
  res.json({ authenticated: !!token });
});

app.post('/send-email', upload.single('file'), async (req, res) => {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { to, subject, text, html } = req.body;
  const file = req.file;

  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  console.log("BODY:", req.body);
  console.log("FILE:", req.file);

  // ✅ STEP 1: Upload to OneDrive
  let fileUrl = null;

  if (file) {
    const uploadResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root:/SwarmResults/${Date.now()}-${file.originalname}:/content`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': file.mimetype || 'application/octet-stream', // safer than file.mimetype
        },
        body: file.buffer,
      }
    );

    const result = await uploadResponse.json();

    if (!uploadResponse.ok) {
      console.error("Upload failed:", result);
      return res.status(500).json({ error: result.error?.message });
    }

    fileUrl = result.webUrl;
    console.log("Uploaded to OneDrive:", fileUrl);
  }

  // ✅ STEP 2: Send email (with link instead of attachment)
  const message = {
    message: {
      subject,
      body: {
        contentType: 'Text',
        content: `${text}\n\nFile uploaded here: ${fileUrl || 'No file uploaded'}`,
      },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  };

  const response = await fetch(
    'https://graph.microsoft.com/v1.0/me/sendMail',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    }
  );

  if (response.status === 202) {
    res.json({ success: true, fileUrl });
  } else {
    const error = await response.json();
    console.error("Mail error:", error);
    res.status(500).json({ error: error.error?.message });
  }
});



app.listen(PORT, () => console.log(`Server running on port ${PORT}`));