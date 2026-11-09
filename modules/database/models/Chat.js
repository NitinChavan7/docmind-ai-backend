const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  title: { type: String, default: 'New conversation', maxlength: 120 },
  lastMessageAt: { type: Date, default: Date.now },
  pendingTurn: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
}, { timestamps: true });
schema.index({ userId: 1, documentId: 1, lastMessageAt: -1 });
module.exports = mongoose.model('Chat', schema, 'chats');
