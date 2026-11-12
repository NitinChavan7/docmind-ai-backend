const mongoose = require('mongoose');
const { withDocumentOperation } = require('../modules/document/services/operation.service');
const documentOperation = (handler, options = {}) => async (req, res, next) => {
  if (!mongoose.isObjectIdOrHexString(req.params.documentId)) return res.status(400).json({ success: false, message: 'Invalid document ID' });
  try { await withDocumentOperation(req.user.id, req.params.documentId, (document, ensureLease) => { req.documentOperation = { document, ensureLease }; return handler(req, res, next); }, options); }
  catch (error) {
    if (res.headersSent) return next(error);
    next(error);
  }
};
module.exports = documentOperation;
