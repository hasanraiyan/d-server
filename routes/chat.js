const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const auth = require('../middleware/auth');
const axios = require('axios');
const Joi = require('joi');
const validate = require('../middleware/validate');

// Get chat history for a session (paginated)
router.get('/:sessionId', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const chat = await Chat.findOne({ user: req.userId, sessionId: req.params.sessionId });
    if (!chat) return res.status(404).json({ message: 'Chat session not found' });
    const total = chat.messages.length;
    const messages = chat.messages.slice(skip, skip + limit);
    res.json({ messages, page, limit, total });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Send message to AI and store chat (threaded, with context)
const chatSchema = Joi.object({
  message: Joi.string().required(),
  sessionId: Joi.string().required(),
  type: Joi.string().valid('text', 'image', 'file').optional()
});
router.post('/', auth, validate(chatSchema), async (req, res) => {
  try {
    const { message, sessionId, type } = req.body;
    // Find or create chat session
    let chat = await Chat.findOne({ user: req.userId, sessionId });
    if (!chat) {
      chat = new Chat({ user: req.userId, sessionId, messages: [] });
    }
    // Prepare context for AI (last 10 messages)
    const context = chat.messages.slice(-10).map(m => `${m.sender}: ${m.message}`).join('\n');
    // Call AI API with context
    const aiResponse = await axios.post('https://text.pollinations.ai/openai', {
      prompt: `${context}\nuser: ${message}`,
      apiKey: process.env.AI_API_KEY
    });
    // Save user message
    chat.messages.push({ sender: 'user', message, type: type || 'text' });
    // Save AI message
    chat.messages.push({ sender: 'ai', message: aiResponse.data.response || 'AI reply (stub)', type: 'text' });
    await chat.save();
    res.json({ chat, ai: aiResponse.data.response });
  } catch (err) {
    res.status(500).json({ message: 'AI or server error', error: err.message });
  }
});

// Submit feedback for an AI message in a session
router.post('/:sessionId/feedback', auth, async (req, res) => {
  try {
    const { messageIndex, feedback } = req.body;
    const chat = await Chat.findOne({ user: req.userId, sessionId: req.params.sessionId });
    if (!chat) return res.status(404).json({ message: 'Chat session not found' });
    if (typeof messageIndex !== 'number' || messageIndex < 0 || messageIndex >= chat.messages.length) {
      return res.status(400).json({ message: 'Invalid message index' });
    }
    chat.messages[messageIndex].feedback = feedback;
    await chat.save();
    res.json({ message: 'Feedback saved' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Save AI-suggested task directly to planner
router.post('/:sessionId/save-task', auth, async (req, res) => {
  try {
    const { title, description, dueDate } = req.body;
    const Task = require('../models/Task');
    const task = new Task({ user: req.userId, title, description, dueDate });
    await task.save();
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
