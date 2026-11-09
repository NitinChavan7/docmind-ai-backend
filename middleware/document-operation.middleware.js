const mongoose = require('mongoose');
const { withDocumentOperation } = require('../modules/document/services/operation.service');
const documentOperation = handler => async (req, res, next) => {
  if (!mongoose.isObjectIdOrHexString(req.params.documentId)) return res.status(400).json({ success: false, message: 'Invalid document ID' });
  try { await withDocumentOperation(req.user.id, req.params.documentId, () => handler(req, res)); }
  catch (error) {
    if (res.headersSent) return next(error);
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    next(error);
  }
};
module.exports = documentOperation;
