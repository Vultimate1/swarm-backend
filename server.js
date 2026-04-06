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
const nodemailer = require('nodemailer');
const bodyParser = require('body-parser');
const { ConfidentialClientApplication } = require('@azure/msal-node');

const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const TENANT_ID = process.env.AZURE_TENANT_ID;
const OUTLOOK_EMAIL = process.env.OUTLOOK_EMAIL;

// MSAL config for OAuth2
const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
  },
};

const msalClient = new ConfidentialClientApplication(msalConfig);

// Get OAuth2 access token
async function getAccessToken() {
  const result = await msalClient.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result.accessToken;
}

// Build transporter using fresh token
async function createTransporter() {
  const accessToken = await getAccessToken();
  return nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    auth: {
      type: 'OAuth2',
      user: OUTLOOK_EMAIL,
      accessToken,
    },
  });
}

app.post('/send-email', async (req, res) => {
  const { to, subject, text, html } = req.body;
  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, text/html' });
  }
  try {
    const transporter = await createTransporter();
    const info = await transporter.sendMail({
      from: OUTLOOK_EMAIL,
      to,
      subject,
      text,
      html,
    });
    res.json({ success: true, messageId: info.messageId });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));