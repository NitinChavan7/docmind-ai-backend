const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', default: null },
  requestId: { type: String, required: true },
  requestKey: { type: String, required: true },
  questionHash: { type: String, required: true },
  status: { type: String, enum: ['reserved', 'started', 'completed', 'failed', 'released'], required: true },
  acceptedAt: { type: Date, required: true },
  dailyResetAt: { type: Date, required: true },
  generationKey: { type: String, required: true },
  generationUntil: { type: Date, default: null },
  resourceDeleted: { type: Boolean, default: false },
  result: { type: mongoose.Schema.Types.Mixed, select: false },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ userId: 1, requestKey: 1 }, { unique: true });
schema.index({ userId: 1, acceptedAt: 1 });
schema.index({ userId: 1, generationUntil: 1 });
schema.index({ userId: 1, chatId: 1, status: 1 });
// Only this self-contained accounting ledger uses TTL; PDFs/chats never do.
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('QuestionUsage', schema, 'question_usage');
