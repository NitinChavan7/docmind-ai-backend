const { Document, Chat, Message } = require('../../database');
const registerDocument = data => Document.create({ ...data, status: 'uploaded', pageCount: 0 });
const getAllDocuments = userId => Document.find({ userId }).sort({ createdAt: -1 }).lean();
const getDocumentById = (documentId, userId) => Document.findOne({ _id: documentId, userId }).lean();
const updateDocumentStatus = (documentId, userId, status, pageCount) => Document.findOneAndUpdate(
  { _id: documentId, userId }, { $set: { status, ...(pageCount === undefined ? {} : { pageCount }) } }, { returnDocument: 'after', runValidators: true });
const deleteDocumentById = async (documentId, userId) => {
  await Message.deleteMany({ documentId, userId });
  await Chat.deleteMany({ documentId, userId });
  return Document.findOneAndDelete({ _id: documentId, userId });
};
module.exports = { registerDocument, getAllDocuments, getDocumentById, updateDocumentStatus, deleteDocumentById };
