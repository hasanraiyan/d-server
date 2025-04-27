const express = require('express');
const router = express.Router();
const MoodLog = require('../models/MoodLog');
const auth = require('../middleware/auth');

// Log mood
router.post('/', auth, async (req, res) => {
  try {
    const { mood, note } = req.body;
    const log = new MoodLog({ user: req.userId, mood, note });
    await log.save();
    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get mood logs (paginated)
router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      MoodLog.find({ user: req.userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
      MoodLog.countDocuments({ user: req.userId })
    ]);
    res.json({ logs, page, limit, total });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
