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




const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
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

// getting computer IP address
app.enable('trust proxy');
app.get('/api/ip', (req, res) => {
  try {
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    console.log("User IP: "+clientIP);
  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).send('Auth failed: ' + err.message);
  }
});


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
    scope: 'https://graph.microsoft.com/Mail.Send offline_access',
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
    scope: 'https://graph.microsoft.com/Mail.Send offline_access',
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


const ONEDRIVE_FOLDER = 'SwarmResults';

// Helper: get the user's default drive ID (works for personal + work accounts)
async function getDriveRoot(accessToken) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Could not access OneDrive: ${err.error?.message}`);
  }

  const drive = await res.json();
  return drive.id; // e.g. "b!abc123..."
}

async function ensureOneDriveFolder(accessToken, folderName) {
  // First try the specific shared link
  const sharedUrl = 'https://studentuml-my.sharepoint.com/:f:/r/personal/kshitij_jerath_uml_edu/Documents/Exalabs_main/Sriram/Webpage%20Files?csf=1&web=1&e=HDgy7W';
  
  try {
    // Encode the sharing URL into a base64 token Graph can use
    const encoded = 'u!' + Buffer.from(sharedUrl).toString('base64')
      .replace(/=/g, '')
      .replace(/\//g, '_')
      .replace(/\+/g, '-');

    const sharedRes = await fetch(
      `https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (sharedRes.ok) {
      const item = await sharedRes.json();
      console.log(`Resolved shared link, folder ID: ${item.id}, drive ID: ${item.parentReference.driveId}`);
      return {
        driveId: item.parentReference.driveId,
        folderId: item.id,
      };
    } else {
      const err = await sharedRes.json();
      console.log(`Could not resolve shared link: ${err.error?.message}, falling back...`);
    }
  } catch (err) {
    console.log(`Shared link error: ${err.message}, falling back...`);
  }

  // Fallback: personal drive
  console.log(`Falling back to personal drive folder "${folderName}"`);
  const listRes = await fetch(
    'https://graph.microsoft.com/v1.0/me/drive/root/children',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!listRes.ok) {
    const err = await listRes.json();
    throw new Error(`Failed to list drive root: ${err.error?.message}`);
  }

  const { value: items } = await listRes.json();
  const existing = items.find(
    item => item.folder && item.name.toLowerCase() === folderName.toLowerCase()
  );

  if (existing) {
    console.log(`Found folder "${folderName}" in personal drive: ${existing.id}`);
    return {
      driveId: 'b!yq_ozvkMLkuOIL47RinIhHFbS9WTfrxLkha1dnHiOKnjO1Le3IW5T7IPtcNzQof6',
      folderId: existing.id,
    };
  }

  // Create in personal drive if not found
  const createRes = await fetch(
    'https://graph.microsoft.com/v1.0/me/drive/root/children',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.json();
    throw new Error(`Failed to create OneDrive folder: ${err.error?.message}`);
  }

  const newFolder = await createRes.json();
  console.log(`Created folder "${folderName}" in personal drive: ${newFolder.id}`);
  return {
    driveId: 'b!yq_ozvkMLkuOIL47RinIhHFbS9WTfrxLkha1dnHiOKnjO1Le3IW5T7IPtcNzQof6',
    folderId: newFolder.id,
  };
}

async function uploadToOneDrive(accessToken, folderName, file) {
  const { driveId, folderId } = await ensureOneDriveFolder(accessToken, folderName);

  const safeName = file.originalname.replace(/[":*<>?/\\|]/g, '-');
  console.log(`Uploading "${safeName}" to drive ${driveId}, folder ${folderId}`);

  const sessionRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(safeName)}:/createUploadSession`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        item: {
          '@microsoft.graph.conflictBehavior': 'replace',
          name: safeName,
        },
      }),
    }
  );

  if (!sessionRes.ok) {
    const sessionErr = await sessionRes.json();
    throw new Error(`Failed to create upload session: ${JSON.stringify(sessionErr)}`);
  }

  const { uploadUrl } = await sessionRes.json();

  const fileBuffer = file.buffer;
  const fileSize = fileBuffer.length;

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.mimetype || 'application/octet-stream',
      'Content-Length': String(fileSize),
      'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
    },
    body: fileBuffer,
  });

  if (uploadRes.status !== 200 && uploadRes.status !== 201) {
    const uploadErr = await uploadRes.json().catch(() => ({}));
    throw new Error(`OneDrive upload failed: ${JSON.stringify(uploadErr)}`);
  }

  const uploaded = await uploadRes.json();
  console.log(`Uploaded "${safeName}" to OneDrive folder "${folderName}"`);
  return uploaded;
}

app.get('/debug/drive', async (req, res) => {
  const accessToken = await getAccessToken();
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // Test 1: basic drive info
    const driveRes = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const driveData = await driveRes.json();

    // Test 2: list root children
    const rootRes = await fetch('https://graph.microsoft.com/v1.0/me/drive/root/children', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const rootData = await rootRes.json();

    // Test 3: try drives list
    const drivesRes = await fetch('https://graph.microsoft.com/v1.0/me/drives', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const drivesData = await drivesRes.json();

    res.json({
      driveEndpoint: { status: driveRes.status, body: driveData },
      rootChildren: { status: rootRes.status, body: rootData },
      drivesList: { status: drivesRes.status, body: drivesData },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/debug/upload-session', async (req, res) => {
  const accessToken = await getAccessToken();
  const driveId = 'b!yq_ozvkMLkuOIL47RinIhHFbS9WTfrxLkha1dnHiOKnjO1Le3IW5T7IPtcNzQof6';
  const folderId = '015USV6YYMJSU4O7Y2TVAKQOOPBRL6Q3WE'; // UploadedFiles folder ID from debug output

  const sessionRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/test.txt:/createUploadSession`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace', name: 'test.txt' } }),
    }
  );

  res.json({ status: sessionRes.status, body: await sessionRes.json() });
});

app.get('/debug/shared-folders', async (req, res) => {
  const accessToken = await getAccessToken();
  if (!accessToken) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // List drives shared with you
    const sharedRes = await fetch('https://graph.microsoft.com/v1.0/me/drive/sharedWithMe', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const sharedData = await sharedRes.json();
    res.json(sharedData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

  // Upload to OneDrive if a file was provided
  if (file) {
    try {
      await uploadToOneDrive(accessToken, ONEDRIVE_FOLDER, file);
    } catch (err) {
      console.error('OneDrive upload error:', err.message);
      return res.status(500).json({ error: `OneDrive upload failed: ${err.message}` });
    }
  }

  const attachments = file
    ? [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: file.originalname,
          contentType: file.mimetype,
          contentBytes: file.buffer.toString('base64'),
        },
      ]
    : [];

  const message = {
    message: {
      subject,
      body: {
        contentType: html ? 'HTML' : 'Text',
        content: html || text,
      },
      toRecipients: [{ emailAddress: { address: to } }],
      attachments,
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
    res.json({ success: true });
  } else {
    const error = await response.json();
    res.status(500).json({ error: error.error?.message });
  }
});


/* EMAIL-ONLY POST RESPONSE
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

  const attachments = file
    ? [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: file.originalname,
          contentType: file.mimetype,
          contentBytes: file.buffer.toString('base64'),
        },
      ]
    : [];

  const message = {
    message: {
      subject,
      body: {
        contentType: html ? 'HTML' : 'Text',
        content: html || text,
      },
      toRecipients: [{ emailAddress: { address: to } }],
      attachments,
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
    res.json({ success: true });
  } else {
    const error = await response.json();
    res.status(500).json({ error: error.error?.message });
  }
});
*/


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));