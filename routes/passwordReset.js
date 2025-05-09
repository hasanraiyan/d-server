const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { BACKEND_URL } = require('../config/constants');
// const rateLimit = require('express-rate-limit'); // Uncomment for production

const PasswordResetToken = require('../models/PasswordResetToken');

// Helper: Validate email format
function isValidEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

// Helper: Validate password strength (simple example)
function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}


// Password reset request (no user enumeration, robust validation)
router.post('/request', async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ message: 'Invalid email address.' });
  }
  try {
    const user = await User.findOne({ email });
    // Always respond with success to prevent user enumeration
    if (!user) {
      return res.json({ message: 'If the email exists, a reset link has been sent.' });
    }
    // Generate a cryptographically secure token (JWT + random salt)
    const salt = crypto.randomBytes(16).toString('hex');
    const token = jwt.sign({ userId: user._id, salt }, process.env.JWT_SECRET, { expiresIn: '1h' });
    // Save token in DB (invalidate previous tokens for this user)
    await PasswordResetToken.updateMany({ userId: user._id, used: false }, { used: true });
    await PasswordResetToken.create({ userId: user._id, token, expiresAt: Date.now() + 60 * 60 * 1000 });
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    const resetLink = `${BACKEND_URL}/api/password-reset/reset-password/${token}`;
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Dostify Password Reset',
      text: `Reset your password using this link: ${resetLink}`
    });
    res.json({ message: 'If the email exists, a reset link has been sent.' });
  } catch (err) {
    // Log error for audit, but never leak details to client
    const logger = require('../logger');
logger.error('Password reset request error:', err);
    res.status(500).json({ message: 'Server error. Please try again later.' });
  }
});

// Show a password reset form when visiting the reset link directly
router.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  res.send(`
    <html>
      <head><title>Password Reset</title></head>
      <body>
        <h2>Password Reset</h2>
        <form method="POST" action="/api/password-reset/reset/${token}">
          <label for="password">Enter new password:</label><br/>
          <input type="password" id="password" name="password" minlength="8" required><br/>
          <button type="submit">Reset Password</button>
        </form>
      </body>
    </html>
  `);
});

// Optionally, handle POST from HTML form and show a user-friendly HTML response
router.post('/reset/:token', async (req, res) => {
  const { token } = req.params;
  // Support both JSON (API) and form submissions
  const password = req.body.password || (req.body && req.body['password']);
  if (!password || !isValidPassword(password)) {
    // If request is from browser, show HTML error
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/x-www-form-urlencoded')) {
      return res.send('<html><body><p style="color:red">Password must be at least 8 characters.</p><a href="javascript:history.back()">Go Back</a></body></html>');
    }
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }
  try {
    const tokenDoc = await PasswordResetToken.findOne({ token });
    if (!tokenDoc || tokenDoc.used || tokenDoc.expiresAt < Date.now()) {
      if (req.headers['content-type'] && req.headers['content-type'].includes('application/x-www-form-urlencoded')) {
        return res.send('<html><body><p style="color:red">Token already used or expired.</p></body></html>');
      }
      return res.status(400).json({ message: 'Token already used or expired.' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) {
      if (req.headers['content-type'] && req.headers['content-type'].includes('application/x-www-form-urlencoded')) {
        return res.send('<html><body><p style="color:red">Invalid token.</p></body></html>');
      }
      return res.status(400).json({ message: 'Invalid token.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(decoded.userId, { password: hashedPassword });
    tokenDoc.used = true;
    await tokenDoc.save();
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/x-www-form-urlencoded')) {
      return res.send('<html><body><p style="color:green">Password reset successful. You may now close this window.</p></body></html>');
    }
    res.json({ message: 'Password reset successful.' });
  } catch (err) {
    logger.error('Password reset error:', err);
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/x-www-form-urlencoded')) {
      return res.send('<html><body><p style="color:red">Invalid or expired token.</p></body></html>');
    }
    res.status(400).json({ message: 'Invalid or expired token.' });
  }
});

// Password reset (single-use, robust validation, error handling)
router.post('/reset/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  if (!password || !isValidPassword(password)) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }
  try {
    // Look up token in DB
    const tokenDoc = await PasswordResetToken.findOne({ token });
    if (!tokenDoc || tokenDoc.used || tokenDoc.expiresAt < Date.now()) {
      return res.status(400).json({ message: 'Token already used or expired.' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Optionally check if user still exists
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(400).json({ message: 'Invalid token.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.findByIdAndUpdate(decoded.userId, { password: hashedPassword });
    tokenDoc.used = true;
    await tokenDoc.save();
    res.json({ message: 'Password reset successful.' });
  } catch (err) {
    logger.error('Password reset error:', err);
    res.status(400).json({ message: 'Invalid or expired token.' });
  }
});

// TODO: Add rate limiting to /request and /reset endpoints for production
// Example:
// router.use('/request', rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }));

module.exports = router;
