const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const auth = require('../middleware/auth');
const axios = require('axios');
const Joi = require('joi');
const validate = require('../middleware/validate');

// Get all tasks for user (paginated)
router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const [tasks, total] = await Promise.all([
      Task.find({ user: req.userId }).skip(skip).limit(limit).sort({ dueDate: 1 }),
      Task.countDocuments({ user: req.userId })
    ]);
    res.json({ tasks, page, limit, total });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Add a new task
const taskSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().allow('').optional(),
  dueDate: Joi.date().optional()
});
router.post('/', auth, validate(taskSchema), async (req, res) => {
  try {
    const { title, description, dueDate } = req.body;
    const task = new Task({ user: req.userId, title, description, dueDate });
    await task.save();
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark task as complete
const completeSchema = Joi.object({ id: Joi.string().length(24).hex().required() });
router.patch('/:id/complete', auth, validate(completeSchema, 'params'), async (req, res) => {
  try {
    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { completed: true },
      { new: true }
    );
    if (!task) return res.status(404).json({ message: 'Task not found' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @swagger
 * /api/planner/ai:
 *   post:
 *     summary: Generate a personalized study plan using AI
 *     tags: [Planner]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               goals:
 *                 type: string
 *                 description: User's academic goals or context
 *               timeframe:
 *                 type: string
 *                 description: Time period for the study plan (e.g., '1 week')
 *     responses:
 *       200:
 *         description: AI-generated study plan
 *       500:
 *         description: AI or server error
 */
const aiPlannerSchema = Joi.object({
  goals: Joi.string().required(),
  timeframe: Joi.string().required()
});
router.post('/ai', auth, validate(aiPlannerSchema), async (req, res) => {
  try {
    const { goals, timeframe } = req.body;
    // Compose prompt for AI
    const prompt = `Create a detailed study plan for: ${goals}. Timeframe: ${timeframe}. Format as a checklist with tasks and deadlines.`;
    // Call AI API (stub - replace with real integration)
    const aiResponse = await axios.post(process.env.AI_API_URL, {
      prompt,
      apiKey: process.env.AI_API_KEY
    });
    // Example: parse response as a list of tasks (customize as needed)
    res.json({ plan: aiResponse.data.response || 'AI plan (stub)' });
  } catch (err) {
    res.status(500).json({ message: 'AI or server error', error: err.message });
  }
});

module.exports = router;
