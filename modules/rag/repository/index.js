const { Document } = require("../../database");

const { searchDocumentChunks } = require("../services/vector.service");

// Check document exists and is indexed
const getReadyDocument = async (documentId, userId) => {
  return await Document.findOne({
    _id: documentId,
    userId,
    status: "ready",
  }).lean();
};

// Retrieve relevant PDF chunks
const retrieveDocumentContext = async (documentId, embedding, limit = 3, options = {}) => {
  return await searchDocumentChunks(documentId, embedding, limit, options);
};

module.exports = {
  getReadyDocument,
  retrieveDocumentContext,
};
