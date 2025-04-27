const express = require('express');
const router = express.Router();
const Feedback = require('../models/Feedback');
const auth = require('../middleware/auth');
const Joi = require('joi');
const validate = require('../middleware/validate');

// Submit feedback
const feedbackSchema = Joi.object({
  rating: Joi.number().min(1).max(5).required(),
  comment: Joi.string().allow('').optional()
});
router.post('/', auth, validate(feedbackSchema), async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const feedback = new Feedback({ user: req.userId, rating, comment });
    await feedback.save();
    res.status(201).json(feedback);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
