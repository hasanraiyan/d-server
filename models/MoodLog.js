const mongoose = require('mongoose');

const MoodLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mood: { type: Number, required: true }, // 1-10 scale
  note: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MoodLog', MoodLogSchema);
