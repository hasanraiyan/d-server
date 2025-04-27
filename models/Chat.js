const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId: { type: String, required: true, index: true }, // For threaded conversations
  title: { type: String }, // Optional session title
  lastActivity: { type: Date, default: Date.now }, // Last message timestamp
  messages: [
    {
      sender: String, // 'user' or 'ai'
      message: String,
      type: String,
      feedback: Number,
      timestamp: { type: Date, default: Date.now }
    }
  ]
}, { timestamps: true });

module.exports = mongoose.model('Chat', ChatSchema);
