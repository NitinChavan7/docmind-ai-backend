const { Document, Chat, Message } = require('../../database');
const { availableFilter, assertAvailable } = require('../../usage/resources');
const registerDocument = data => Document.create({ ...data, status: 'uploaded', pageCount: 0 });
const getAllDocuments = userId => Document.find({ userId, ...availableFilter(), uploadState: { $ne: 'pending' } }).sort({ createdAt: -1 }).lean();
const getDocumentById = async (documentId, userId) => {
  const document = await Document.findOne({ _id: documentId, userId }).lean();
  return document ? assertAvailable(document) : null;
};
const updateDocumentStatus = (documentId, userId, status, pageCount) => Document.findOneAndUpdate(
  { _id: documentId, userId }, { $set: { status, ...(pageCount === undefined ? {} : { pageCount }) } }, { returnDocument: 'after', runValidators: true });
const deleteDocumentById = async (documentId, userId) => {
  await Message.deleteMany({ documentId, userId });
  await Chat.deleteMany({ documentId, userId });
  return Document.findOneAndDelete({ _id: documentId, userId });
};
module.exports = { registerDocument, getAllDocuments, getDocumentById, updateDocumentStatus, deleteDocumentById };
