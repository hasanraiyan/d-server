const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const auth = require('../middleware/auth');
const Joi = require('joi');
const validate = require('../middleware/validate');

// Stub: Send notification (email)
const notificationSchema = Joi.object({
  to: Joi.string().email().required(),
  subject: Joi.string().required(),
  text: Joi.string().required()
});
router.post('/email', auth, validate(notificationSchema), async (req, res) => {
  const { to, subject, text } = req.body;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text
    });
    res.json({ message: 'Notification sent' });
  } catch (err) {
    res.status(500).json({ message: 'Notification failed', error: err.message });
  }
});

module.exports = router;
