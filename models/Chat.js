// FILE: models/Chat.js
const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId: { type: String, required: true, index: true }, // For threaded conversations
  title: { type: String }, // Optional session title
  lastActivity: { type: Date, default: Date.now }, // Last message timestamp
  messages: [
    {
      sender: String, // 'user' or 'ai'
      message: String, // Text content
      type: String, // 'text', 'image', 'file' etc. (can store user input type)
      imageUrl: String, // <<--- ADDED: Store URL if user sent an image
      feedback: Number, // Optional: 1-5 rating for AI message
      timestamp: { type: Date, default: Date.now }
      // Consider adding tool_call details if needed for complex debugging
      // tool_call_id: String,
      // tool_calls: mongoose.Schema.Types.Mixed
    }
  ]
}, { timestamps: true });

module.exports = mongoose.model('Chat', ChatSchema);