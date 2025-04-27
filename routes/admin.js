const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Feedback = require('../models/Feedback');
const Chat = require('../models/Chat');
const auth = require('../middleware/auth');

// Middleware stub for admin auth (replace with real admin check)
function adminOnly(req, res, next) {
  // TODO: Implement real admin check
  if (req.userId && req.headers['x-admin'] === 'true') return next();
  return res.status(403).json({ message: 'Admin access required' });
}

// Get user analytics
router.get('/users', auth, adminOnly, async (req, res) => {
  const count = await User.countDocuments();
  res.json({ userCount: count });
});

// Get feedback analytics
router.get('/feedback', auth, adminOnly, async (req, res) => {
  const feedbacks = await Feedback.find();
  res.json({ feedbacks });
});

// Get chat analytics (number of chats)
router.get('/chats', auth, adminOnly, async (req, res) => {
  const count = await Chat.countDocuments();
  res.json({ chatCount: count });
});

module.exports = router;
