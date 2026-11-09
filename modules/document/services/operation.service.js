const crypto = require('crypto');
const { Document } = require('../../database');
// Serialize indexing, answering and deletion across backend instances.
const withDocumentOperation = async (userId, documentId, operation, { signal, onLeaseLost } = {}) => {
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
  let lost = false;
  const loseLease = () => {
    if (lost) return;
    lost = true;
    onLeaseLost?.(new Error('Document operation interrupted'));
  };
  const heartbeat = setInterval(() => {
    Document.updateOne(filter, { $set: { operationUntil: new Date(Date.now() + 600000) } })
      .then(result => { if (!result.matchedCount) loseLease(); }).catch(loseLease);
  }, 30000);
  heartbeat.unref();
  try {
    signal?.throwIfAborted();
    return await operation(document, () => { signal?.throwIfAborted(); if (lost) throw new Error('Document operation interrupted'); });
  }
  finally {
    clearInterval(heartbeat);
    await Document.updateOne(filter, { $set: { operationKey: null, operationUntil: null } });
  }
};
module.exports = { withDocumentOperation };
