const crypto = require('crypto');
const { Document } = require('../../database');
const { assertAvailable } = require('../../usage/resources');
// Serialize indexing, answering and deletion across backend instances.
const withDocumentOperation = async (userId, documentId, operation, { signal, onLeaseLost, allowUnavailable = false, allowPending = false } = {}) => {
  signal?.throwIfAborted();
  const key = crypto.randomUUID();
  const filter = { _id: documentId, userId, operationKey: key };
  const document = await Document.findOneAndUpdate({ _id: documentId, userId,
    $or: [{ operationUntil: null }, { operationUntil: { $lt: new Date() } }],
  }, { $set: { operationKey: key, operationUntil: new Date(Date.now() + 600000) } }, { returnDocument: 'after' }).lean();
  if (!document) {
    const exists = await Document.exists({ _id: documentId, userId });
    throw Object.assign(new Error(exists ? 'Document is busy. Try again shortly.' : 'Document not found'), { status: exists ? 409 : 404 });
  }
  let lost = false, validUntil = new Date(document.operationUntil).getTime();
  const loseLease = () => {
    if (lost) return;
    lost = true;
    onLeaseLost?.(new Error('Document operation interrupted'));
  };
  const heartbeat = setInterval(() => {
    const until = Date.now() + 600000;
    Document.updateOne({ ...filter, operationUntil: { $gt: new Date() } }, { $set: { operationUntil: new Date(until) } })
      .then(result => { if (!result.matchedCount) loseLease(); else validUntil = until; }).catch(loseLease);
  }, 30000);
  heartbeat.unref();
  const ensureLease = () => {
    signal?.throwIfAborted();
    if (lost || Date.now() >= validUntil) throw new Error('Document operation interrupted');
    if (!allowUnavailable) assertAvailable(document, 'DOCUMENT', { allowPending });
  };
  try {
    signal?.throwIfAborted();
    ensureLease();
    return await operation(document, ensureLease);
  }
  finally {
    clearInterval(heartbeat);
    await Document.updateOne(filter, { $set: { operationKey: null, operationUntil: null } });
  }
};
module.exports = { withDocumentOperation };
