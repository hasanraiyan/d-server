// FILE: models/Chat.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  sender: { type: String, required: true, enum: ['user', 'ai', 'tool'] },
  message: { type: String },
  type: { type: String, default: 'text' },
  imageUrl: { type: String },
  feedback: { type: Number, min: 1, max: 5 },
  timestamp: { type: Date, default: Date.now },
  tool_calls: [{ // Array if multiple calls are possible in one response
    id: String,
    type: { type: String, default: 'function' },
    function: {
      name: String,
      arguments: String // Arguments as JSON string from AI
    }
  }],
  tool_call_id: { type: String }, // ID of the tool call this result corresponds to
  tool_name: { type: String }, // Name of the function that was called
  toolResultData: mongoose.Schema.Types.Mixed // Store the actual result object ({success: boolean, ...})
});

const ChatSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId: { type: String, required: true, index: true },
  title: { type: String }, // Optional session title
  lastActivity: { type: Date, default: Date.now, index: true },
  messages: [MessageSchema]
}, { timestamps: true });

// Optimize query performance for fetching messages within a session
ChatSchema.index({ user: 1, sessionId: 1, lastActivity: -1 });

module.exports = mongoose.model('Chat', ChatSchema);