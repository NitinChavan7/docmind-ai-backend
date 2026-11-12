const { usageError } = require('./errors');
const availableFilter = (now = new Date()) => ({
  deletionPending: { $ne: true },
  $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
});
const assertAvailable = (resource, kind = 'DOCUMENT', { allowPending = false } = {}) => {
  if (!resource) throw Object.assign(new Error(`${kind === 'CHAT' ? 'Chat' : 'Document'} not found`), { status: 404 });
  if (resource.expiresAt && new Date(resource.expiresAt) <= new Date()) {
    throw usageError(410, `${kind}_EXPIRED`, `This ${kind === 'CHAT' ? 'conversation' : 'PDF'} has expired.`);
  }
  if (resource.deletionPending || (!allowPending && resource.uploadState === 'pending')) {
    throw Object.assign(new Error('Resource unavailable'), { status: 404 });
  }
  return resource;
};
const utcWindow = (now = new Date()) => {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, resetAt: new Date(start.getTime() + 86400000) };
};
module.exports = { availableFilter, assertAvailable, utcWindow };
