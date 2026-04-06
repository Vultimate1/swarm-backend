require("dotenv").config();
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
});