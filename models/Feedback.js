const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  rating: { type: Number, required: true }, // 1-5
  comment: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Feedback', FeedbackSchema);
