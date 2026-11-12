const { Document } = require("../../database");
const { assertAvailable } = require('../../usage/resources');

const { searchDocumentChunks } = require("../services/vector.service");

// Check document exists and is indexed
const getReadyDocument = async (documentId, userId) => {
  const document = await Document.findOne({
    _id: documentId,
    userId,
    status: "ready",
  }).lean();
  return document ? assertAvailable(document) : null;
};

// Retrieve relevant PDF chunks
const retrieveDocumentContext = async (documentId, embedding, limit = 3, options = {}) => {
  return await searchDocumentChunks(documentId, embedding, limit, options);
};

module.exports = {
  getReadyDocument,
  retrieveDocumentContext,
};
