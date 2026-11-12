const { createHash } = require('crypto');
const { Document } = require('../../database');
const { inspectPdfBuffer } = require('./pdf.service');
const storage = require('./storage.service');
const { reserveUpload } = require('../../usage/usage.service');
const { cleanupDocument } = require('../../usage/cleanup.service');
const { withDocumentOperation } = require('./operation.service');

const uploadDocument = async (userId, file, buffer) => {
  const pageCount = await inspectPdfBuffer(buffer, file.mimetype);
  const reservation = await reserveUpload(userId, {
    originalName: file.originalname, fileName: file.filename,
    filePath: `${userId}/${file.filename}`, mimeType: 'application/pdf', fileSize: buffer.length,
    pageCount, contentHash: createHash('sha256').update(buffer).digest('hex'),
  });
  if (reservation.duplicate) return reservation.document;
  const documentId = reservation.document._id;
  try {
    return await withDocumentOperation(userId, documentId, async (document, ensureLease) => {
      await storage.uploadPdf(document.filePath, buffer);
      ensureLease();
      return Document.findOneAndUpdate({ _id: documentId, userId }, { $set: { uploadState: 'complete', uploadUntil: null } }, { returnDocument: 'after' }).lean();
    }, { allowPending: true });
  } catch (error) {
    // Staging metadata is a durable cleanup job even if the upload succeeded
    // remotely and the response or subsequent database write was lost.
    await Document.updateOne({ _id: documentId, userId }, { $set: { deletionPending: true } });
    await cleanupDocument(userId, documentId).catch(() => {});
    throw error;
  }
};
module.exports = { uploadDocument };
