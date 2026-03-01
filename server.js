require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());

const upload = multer({ dest: "uploads/" });
app.get("/", (req, res) => {
  res.send("Backend is running");
});
app.post("/send-email", upload.single("file"), async (req, res) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
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
          path: req.file.path
        }
      ]
    });

    res.send("Email sent!");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error sending email");
  }
});


app.listen(process.env.PORT || 5000, () => {
  console.log("Server running");
});