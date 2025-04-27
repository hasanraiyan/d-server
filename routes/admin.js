const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Feedback = require('../models/Feedback');
const Chat = require('../models/Chat');
const adminOnly = require('../middleware/adminOnly');

// Get user analytics
router.get('/users/count', adminOnly, async (req, res) => {
  const count = await User.countDocuments();
  res.json({ userCount: count });
});

// Get feedback analytics
router.get('/feedback/analytics', adminOnly, async (req, res) => {
  const feedbacks = await Feedback.find();
  res.json({ feedbacks });
});

// Get chat analytics (number of chats)
router.get('/chats/count', adminOnly, async (req, res) => {
  const count = await Chat.countDocuments();
  res.json({ chatCount: count });
});

module.exports = router;
