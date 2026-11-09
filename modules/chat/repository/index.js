const { Chat, Message, Document } = require('../../database');
const scope = chat => ({ userId: chat.userId, documentId: chat.documentId, chatId: chat._id });
const getOwnedDocument = (userId, documentId) => Document.findOne({ _id: documentId, userId }).lean();
const getOwnedChat = (userId, chatId) => Chat.findOne({ _id: chatId, userId }).select('+pendingTurn').lean();
const getChats = (userId, documentId) => Chat.find({ userId, documentId }).sort({ lastMessageAt: -1, _id: -1 }).limit(100).lean();
const createChat = (userId, documentId) => Chat.create({ userId, documentId });
const getMessages = (chat, before, limit) => Message.find({ ...scope(chat), committed: true, ...(before ? { _id: { $lt: before } } : {}) }).sort({ _id: -1 }).limit(limit).lean();
const getTurn = (chat, requestId) => Message.find({ ...scope(chat), requestId, committed: true }).sort({ _id: 1 }).lean();
const saveTurn = async (chat, requestId, question, result, messageIds) => {
  // Journal the full turn atomically before writing individual message records.
  // Readers recover this journal while holding the same document lease.
  await Chat.updateOne({ _id: chat._id, userId: chat.userId }, { $set: { pendingTurn: { requestId, question, result, messageIds } } });
  return recoverTurn({ ...chat, pendingTurn: { requestId, question, result, messageIds } });
};
const recoverTurn = async chat => {
  if (!chat?.pendingTurn) return;
  const { requestId, question, result, messageIds } = chat.pendingTurn;
  const filter = { ...scope(chat), requestId };
  await Message.bulkWrite([
    { updateOne: { filter: { ...filter, role: 'user' }, update: { $setOnInsert: { ...filter, ...(messageIds?.user ? { _id: messageIds.user } : {}), role: 'user', content: question, committed: false } }, upsert: true } },
    { updateOne: { filter: { ...filter, role: 'assistant' }, update: { $setOnInsert: { ...filter, ...(messageIds?.assistant ? { _id: messageIds.assistant } : {}), role: 'assistant', content: result.answer, sources: result.sources, committed: false } }, upsert: true } },
  ], { ordered: true });
  await Message.updateMany(filter, { $set: { committed: true } });
  await Chat.updateOne({ _id: chat._id, userId: chat.userId, documentId: chat.documentId }, {
    $set: { pendingTurn: null, lastMessageAt: new Date(), ...(chat.title === 'New conversation' ? { title: question.slice(0, 100) } : {}) },
  });
  return getTurn(chat, requestId);
};
module.exports = { getOwnedDocument, getOwnedChat, getChats, createChat, getMessages, getTurn, saveTurn, recoverTurn };
