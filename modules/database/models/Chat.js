const mongoose = require('mongoose');
const limits = require('../../../config/usage-limits');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  title: { type: String, default: 'New conversation', maxlength: 120 },
  lastMessageAt: { type: Date, default: Date.now },
  pendingTurn: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
  expiresAt: { type: Date, default: () => new Date(Date.now() + limits.chatRetentionDays * limits.DAY_MS) },
  deletionPending: { type: Boolean, default: false },
}, { timestamps: true });
schema.index({ userId: 1, documentId: 1, lastMessageAt: -1 });
schema.index({ userId: 1, expiresAt: 1 });
schema.index({ expiresAt: 1, deletionPending: 1 });
module.exports = mongoose.model('Chat', schema, 'chats');
