const express = require('express');
const router = express.Router();
const Chat = require('../models/Chat');
const auth = require('../middleware/auth');
const axios = require('axios');
const Joi = require('joi');
const validate = require('../middleware/validate');
const Task = require('../models/Task');

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
  type: Joi.string().valid('text', 'image', 'file').optional(),
  imageUrl: Joi.string().uri().optional() // For vision/multimodal
});
// --- OpenAI Function Calling (Tools) Definitions ---
const aiTools = [
  {
    name: 'log_mood',
    description: 'Log a mood entry for the current user',
    parameters: {
      type: 'object',
      properties: {
        mood: { type: 'integer', description: 'Mood value from 1-10' },
        note: { type: 'string', description: 'Optional note about mood' }
      },
      required: ['mood']
    }
  },
  {
    name: 'create_task',
    description: 'Create a planner task for the current user',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        dueDate: { type: 'string', format: 'date', description: 'Due date (YYYY-MM-DD)' }
      },
      required: ['title']
    }
  },
  {
    name: 'update_task',
    description: 'Update a planner task for the current user',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to update' },
        title: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        dueDate: { type: 'string', format: 'date', description: 'New due date (optional)' },
        completed: { type: 'boolean', description: 'Mark as completed (optional)' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'delete_task',
    description: 'Delete a planner task for the current user',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID to delete' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'get_tasks',
    description: 'Get all planner tasks for the current user',
    parameters: {
      type: 'object',
      properties: {
        completed: { type: 'boolean', description: 'Filter by completed status (optional)' }
      },
      required: []
    }
  },
  {
    name: 'get_mood_history',
    description: 'Get the mood log history for the current user',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Number of days to look back (optional, default 30)' }
      },
      required: []
    }
  },
  {
    name: 'get_session_summary',
    description: 'Get a summary of the current chat session',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Chat session ID' }
      },
      required: ['sessionId']
    }
  },
  {
    name: 'give_feedback',
    description: 'Submit feedback for an AI message',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Chat session ID' },
        messageIndex: { type: 'integer', description: 'Index of the message to rate' },
        feedback: { type: 'integer', description: 'Feedback rating (1-5)' }
      },
      required: ['sessionId', 'messageIndex', 'feedback']
    }
  }
];

// --- Chat POST endpoint with tool/function calling support ---
router.post('/', auth, validate(chatSchema), async (req, res) => {
  try {
    const { message, sessionId, type, imageUrl } = req.body;
    let chat = await Chat.findOne({ user: req.userId, sessionId });
    if (!chat) {
      chat = new Chat({ user: req.userId, sessionId, messages: [] });
    }
    // Prepare context for AI (last 10 messages)
    const contextMsgs = chat.messages.slice(-10).map(m => {
      if (m.type === 'image' && m.imageUrl) {
        return { role: m.sender === 'user' ? 'user' : 'assistant', content: [{ type: 'text', text: m.message }, { type: 'image_url', image_url: { url: m.imageUrl } }] };
      } else {
        return { role: m.sender === 'user' ? 'user' : 'assistant', content: m.message };
      }
    });
    // Add current user message
    let currentMsg;
    if (type === 'image' && imageUrl) {
      currentMsg = { role: 'user', content: [{ type: 'text', text: message }, { type: 'image_url', image_url: { url: imageUrl } }] };
    } else {
      currentMsg = { role: 'user', content: message };
    }
    const messages = [...contextMsgs, currentMsg];
    // Call Pollinations OpenAI-compatible endpoint with tools
    const aiResponse = await axios.post(process.env.AI_API_URL, {
      model: 'openai',
      messages,
      tools: aiTools,
      apiKey: process.env.AI_API_KEY
    });
    // Handle function_call/tool use
    let toolResult = null;
    let followUpAI = null;
    let followUpAIImageUrl = null;
    if (aiResponse.data.function_call) {
      const { name, arguments: args } = aiResponse.data.function_call;
      const Task = require('../models/Task');
      const MoodLog = require('../models/MoodLog');
      const ChatModel = require('../models/Chat');
      if (name === 'log_mood') {
        const moodDoc = new MoodLog({ user: req.userId, mood: args.mood, note: args.note });
        await moodDoc.save();
        toolResult = { message: `Mood logged: ${args.mood}${args.note ? ' (' + args.note + ')' : ''}` };
      } else if (name === 'create_task') {
        const taskDoc = new Task({ user: req.userId, title: args.title, description: args.description, dueDate: args.dueDate });
        await taskDoc.save();
        toolResult = { message: `Task created: ${args.title}` };
      } else if (name === 'update_task') {
        const updateFields = {};
        if (args.title) updateFields.title = args.title;
        if (args.description) updateFields.description = args.description;
        if (args.dueDate) updateFields.dueDate = args.dueDate;
        if (typeof args.completed === 'boolean') updateFields.completed = args.completed;
        const updated = await Task.findOneAndUpdate({ _id: args.taskId, user: req.userId }, updateFields, { new: true });
        toolResult = updated ? { message: `Task updated: ${updated.title}` } : { message: 'Task not found or not updated.' };
      } else if (name === 'delete_task') {
        const deleted = await Task.findOneAndDelete({ _id: args.taskId, user: req.userId });
        toolResult = deleted ? { message: `Task deleted: ${deleted.title}` } : { message: 'Task not found or not deleted.' };
      } else if (name === 'get_tasks') {
        const filter = { user: req.userId };
        if (typeof args.completed === 'boolean') filter.completed = args.completed;
        const tasks = await Task.find(filter).sort({ dueDate: 1 });
        toolResult = { tasks };
      } else if (name === 'get_mood_history') {
        const days = args.days || 30;
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const moods = await MoodLog.find({ user: req.userId, createdAt: { $gte: since } }).sort({ createdAt: -1 });
        toolResult = { moods };
      } else if (name === 'get_session_summary') {
        const chatSession = await ChatModel.findOne({ user: req.userId, sessionId: args.sessionId });
        if (chatSession) {
          toolResult = {
            sessionId: chatSession.sessionId,
            title: chatSession.title,
            createdAt: chatSession.createdAt,
            lastActivity: chatSession.lastActivity,
            messageCount: chatSession.messages.length,
            lastMessage: chatSession.messages.length > 0 ? chatSession.messages[chatSession.messages.length - 1] : null
          };
        } else {
          toolResult = { message: 'Session not found.' };
        }
      } else if (name === 'give_feedback') {
        const chatSession = await ChatModel.findOne({ user: req.userId, sessionId: args.sessionId });
        if (chatSession && chatSession.messages[args.messageIndex]) {
          chatSession.messages[args.messageIndex].feedback = args.feedback;
          await chatSession.save();
          toolResult = { message: `Feedback submitted for message ${args.messageIndex}` };
        } else {
          toolResult = { message: 'Could not find message to give feedback.' };
        }
      }
      // After toolResult, send it as a new message to the AI
      if (toolResult) {
        const followUpMsgs = [...messages, { role: 'system', content: typeof toolResult === 'object' ? JSON.stringify(toolResult) : String(toolResult) }];
        const followUpResp = await axios.post(process.env.AI_API_URL, {
          model: 'openai',
          messages: followUpMsgs,
          apiKey: process.env.AI_API_KEY
        });
        followUpAI = followUpResp.data.response || 'AI follow-up (stub)';
        if (followUpResp.data.image_url) followUpAIImageUrl = followUpResp.data.image_url;
      }
    }
    // Save user message
    chat.messages.push({ sender: 'user', message, type: type || 'text', imageUrl });
    // Save AI message (handle multimodal response)
    let aiMsg = aiResponse.data.response || 'AI reply (stub)';
    let aiType = 'text';
    let aiImageUrl = undefined;
    if (aiResponse.data.image_url) {
      aiType = 'image';
      aiImageUrl = aiResponse.data.image_url;
    }
    chat.messages.push({ sender: 'ai', message: aiMsg, type: aiType, imageUrl: aiImageUrl });
    // If there was a follow-up AI reply after toolResult, add it to chat
    if (followUpAI) {
      chat.messages.push({ sender: 'ai', message: followUpAI, type: followUpAIImageUrl ? 'image' : 'text', imageUrl: followUpAIImageUrl });
    }
    chat.lastActivity = new Date();
    await chat.save();
    res.json({ chat, ai: followUpAI || aiMsg, aiImageUrl: followUpAIImageUrl || aiImageUrl, toolResult, timestamp: new Date().toISOString() });
  } catch (err) {
    // Enhanced error logging
    console.error('POST /api/chat error:', {
      message: err.message,
      stack: err.stack,
      requestBody: req.body,
      aiApiUrl: process.env.AI_API_URL,
      aiApiKeySet: !!process.env.AI_API_KEY,
    });
    // If axios error, log response if available
    if (err.response) {
      console.error('AI API error response:', {
        status: err.response.status,
        data: err.response.data,
      });
    }
    // Return detailed error in development, generic in production
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(500).json({
      message: 'AI or server error',
      error: isDev ? err.message : undefined,
      stack: isDev ? err.stack : undefined,
      details: isDev && err.response ? err.response.data : undefined
    });
  }
});

// List all chat sessions for the current user
router.get('/sessions', auth, async (req, res) => {
  try {
    const sessions = await Chat.find({ user: req.userId })
      .select('sessionId title createdAt lastActivity messages')
      .sort({ lastActivity: -1 });
    const sessionSummaries = sessions.map(s => ({
      sessionId: s.sessionId,
      title: s.title,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      messageCount: s.messages.length
    }));
    res.json(sessionSummaries);
  } catch (err) {
    res.status(500).json({ message: 'Could not fetch chat sessions', error: err.message });
  }
});

// Search chat sessions by title
router.get('/sessions/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ message: 'Missing search query' });
    const sessions = await Chat.find({ user: req.userId, title: { $regex: q, $options: 'i' } })
      .select('sessionId title createdAt lastActivity messages')
      .sort({ lastActivity: -1 });
    const sessionSummaries = sessions.map(s => ({
      sessionId: s.sessionId,
      title: s.title,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      messageCount: s.messages.length
    }));
    res.json(sessionSummaries);
  } catch (err) {
    res.status(500).json({ message: 'Could not search chat sessions', error: err.message });
  }
});

// Rename a chat session (update title)
router.patch('/sessions/:sessionId/title', auth, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ message: 'Missing title' });
    const chat = await Chat.findOneAndUpdate(
      { user: req.userId, sessionId: req.params.sessionId },
      { title },
      { new: true }
    );
    if (!chat) return res.status(404).json({ message: 'Session not found' });
    res.json({ sessionId: chat.sessionId, title: chat.title });
  } catch (err) {
    res.status(500).json({ message: 'Could not rename session', error: err.message });
  }
});

// Delete a chat session
router.delete('/sessions/:sessionId', auth, async (req, res) => {
  try {
    const result = await Chat.findOneAndDelete({ user: req.userId, sessionId: req.params.sessionId });
    if (!result) return res.status(404).json({ message: 'Session not found' });
    res.json({ message: 'Session deleted', sessionId: req.params.sessionId });
  } catch (err) {
    res.status(500).json({ message: 'Could not delete session', error: err.message });
  }
});

// Export a chat session as JSON
router.get('/sessions/:sessionId/export', auth, async (req, res) => {
  try {
    const chat = await Chat.findOne({ user: req.userId, sessionId: req.params.sessionId });
    if (!chat) return res.status(404).json({ message: 'Session not found' });
    res.setHeader('Content-Disposition', `attachment; filename="chat_${chat.sessionId}.json"`);
    res.json(chat);
  } catch (err) {
    res.status(500).json({ message: 'Could not export session', error: err.message });
  }
});

// Paginated message retrieval for a session
router.get('/sessions/:sessionId/messages', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const chat = await Chat.findOne({ user: req.userId, sessionId: req.params.sessionId });
    if (!chat) return res.status(404).json({ message: 'Session not found' });
    const start = (parseInt(page) - 1) * parseInt(limit);
    const end = start + parseInt(limit);
    const messages = chat.messages.slice(start, end);
    res.json({ sessionId: chat.sessionId, messages, total: chat.messages.length, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ message: 'Could not fetch messages', error: err.message });
  }
});

// Submit feedback for an AI message in a session
const feedbackSchema = Joi.object({
  messageIndex: Joi.number().integer().min(0).required(),
  feedback: Joi.number().integer().min(1).max(5).required()
});
router.post('/:sessionId/feedback', auth, validate(feedbackSchema), async (req, res) => {
  try {
    const { messageIndex, feedback } = req.body;
    const chat = await Chat.findOne({ user: req.userId, sessionId: req.params.sessionId });
    if (!chat) return res.status(404).json({ message: 'Chat session not found' });
    if (messageIndex < 0 || messageIndex >= chat.messages.length) {
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
const saveTaskSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().allow('').optional(),
  dueDate: Joi.date().optional()
});
router.post('/:sessionId/save-task', auth, validate(saveTaskSchema), async (req, res) => {
  try {
    const { title, description, dueDate } = req.body;
    const task = new Task({ user: req.userId, title, description, dueDate });
    await task.save();
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
