const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true, maxlength: 20000 },
  sources: { type: [mongoose.Schema.Types.Mixed], default: [] },
  requestId: { type: String, required: true },
  // Both sides of a turn are inserted invisibly, then published together.
  committed: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ chatId: 1, createdAt: 1, _id: 1 });
schema.index({ chatId: 1, requestId: 1, role: 1 }, { unique: true });
module.exports = mongoose.model('Message', schema, 'messages');
