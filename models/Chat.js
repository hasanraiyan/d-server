const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId: { type: String, required: true, index: true }, // For threaded conversations
  messages: [
    {
      sender: String, // 'user' or 'ai'
      message: String,
      type: { type: String, default: 'text' }, // text, planner, mood, etc.
      feedback: { type: Number, min: 1, max: 5 }, // User feedback on AI response
      timestamp: { type: Date, default: Date.now }
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Chat', ChatSchema);
