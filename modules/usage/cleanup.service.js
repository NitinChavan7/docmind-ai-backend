const { Document, Chat, Message, QuestionUsage } = require('../database');
const { withDocumentOperation } = require('../document/services/operation.service');
const { createHash, randomUUID } = require('crypto');
const limits = require('../../config/usage-limits');
const { utcWindow } = require('./resources');

const preserveLegacyCharges = async scope => {
  const { start, resetAt } = utcWindow();
  // Snapshot today's old committed questions before deleting messages. New
  // requests already have a ledger entry, and setOnInsert never overwrites it.
  for await (const message of Message.find({ ...scope, role: 'user', committed: true, createdAt: { $gte: start, $lt: resetAt } }).lean().cursor()) {
    await QuestionUsage.updateOne({ userId: message.userId, requestKey: `chat:${message.chatId}:${message.requestId}` }, { $setOnInsert: {
      userId: message.userId, documentId: message.documentId, chatId: message.chatId, requestId: message.requestId,
      requestKey: `chat:${message.chatId}:${message.requestId}`,
      questionHash: createHash('sha256').update(`${message.documentId}\n${message.content}`).digest('hex'),
      status: 'completed', acceptedAt: message.createdAt, dailyResetAt: resetAt,
      generationKey: randomUUID(), generationUntil: null, resourceDeleted: true,
      expiresAt: new Date(Date.now() + (Math.max(limits.chatRetentionDays, limits.pdfRetentionDays, 2) + 1) * limits.DAY_MS),
    } }, { upsert: true });
  }
};

// Call while holding the parent's document lease. Retain minimal daily usage:
// deleting a resource must not restore today's already-started question quota.
const deleteChatRecords = async (userId, chatId) => {
  await Chat.updateOne({ _id: chatId, userId }, { $set: { deletionPending: true } });
  await preserveLegacyCharges({ userId, chatId });
  await Message.deleteMany({ userId, chatId });
  await QuestionUsage.updateMany({ userId, chatId, status: 'reserved' }, { $set: { status: 'released' } });
  await QuestionUsage.updateMany({ userId, chatId }, { $set: { resourceDeleted: true, generationUntil: null }, $unset: { result: 1 } });
  await Chat.deleteOne({ _id: chatId, userId });
};
const deleteDocumentRecords = async (document, ensureLease = () => {}) => {
  const storage = require('../document/services/storage.service');
  const vectors = require('../rag/services/vector.service');
  const { _id: documentId, userId, filePath } = document;
  await Document.updateOne({ _id: documentId, userId }, { $set: { deletionPending: true }, $inc: { deletionAttempts: 1 } });
  ensureLease();
  // Both deletion APIs are idempotent. Retry the entire sequence on failure.
  await vectors.deleteDocumentChunks(String(documentId), String(userId));
  ensureLease();
  if (typeof filePath === 'string' && filePath.startsWith(`${userId}/`)) await storage.deletePdf(filePath);
  ensureLease();
  await preserveLegacyCharges({ documentId, userId });
  await Message.deleteMany({ documentId, userId });
  await Chat.deleteMany({ documentId, userId });
  await QuestionUsage.updateMany({ documentId, userId, status: 'reserved' }, { $set: { status: 'released' } });
  await QuestionUsage.updateMany({ documentId, userId }, { $set: { resourceDeleted: true, generationUntil: null }, $unset: { result: 1 } });
  await Document.deleteOne({ _id: documentId, userId });
};
const cleanupDocument = async (userId, documentId) => {
  // A missing record is already cleaned; never accept an object key from callers.
  if (!await Document.exists({ _id: documentId, userId })) return;
  return withDocumentOperation(userId, documentId, deleteDocumentRecords, { allowUnavailable: true });
};
const cleanupExpired = async ({ dryRun = true, now = new Date() } = {}) => {
  const report = { dryRun, documents: 0, chats: 0, failed: 0, skippedLegacyDocuments: 0, skippedLegacyChats: 0 };
  report.skippedLegacyDocuments = await Document.countDocuments({ expiresAt: null });
  report.skippedLegacyChats = await Chat.countDocuments({ expiresAt: null });
  const filter = { userId: { $ne: null }, $or: [
    { expiresAt: { $lte: now, $ne: null } }, { deletionPending: true },
    { uploadState: 'pending', uploadUntil: { $lte: now } },
  ] };
  for await (const document of Document.find(filter).lean().cursor()) {
    report.documents++;
    if (!dryRun) {
      try { await cleanupDocument(document.userId, document._id); }
      catch { report.failed++; console.error('[Cleanup] PDF cleanup deferred', { documentId: String(document._id) }); }
    }
  }
  for await (const chat of Chat.find({ userId: { $ne: null }, $or: [{ expiresAt: { $lte: now, $ne: null } }, { deletionPending: true }] }).lean().cursor()) {
    report.chats++;
    if (!dryRun) {
      try {
        if (await Document.exists({ _id: chat.documentId, userId: chat.userId })) {
          await withDocumentOperation(chat.userId, chat.documentId, () => deleteChatRecords(chat.userId, chat._id), { allowUnavailable: true });
        } else {
          // Orphan chats cannot be accessed by the API; no parent lock exists.
          await deleteChatRecords(chat.userId, chat._id);
        }
      } catch { report.failed++; console.error('[Cleanup] Chat cleanup deferred', { chatId: String(chat._id) }); }
    }
  }
  return report;
};
module.exports = { deleteChatRecords, deleteDocumentRecords, cleanupDocument, cleanupExpired };
