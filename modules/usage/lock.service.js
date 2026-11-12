const { randomUUID } = require('crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { UsageAccount } = require('../database');
const { usageError } = require('./errors');

// Short quota decisions only. External provider work must happen outside this lock.
const withUserLock = async (userId, operation, { signal } = {}) => {
  signal?.throwIfAborted();
  try { await UsageAccount.updateOne({ _id: userId }, { $setOnInsert: { lockKey: null, lockUntil: null } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  const key = randomUUID();
  const deadline = Date.now() + 10000;
  let account;
  do {
    signal?.throwIfAborted();
    account = await UsageAccount.findOneAndUpdate({ _id: userId,
      $or: [{ lockUntil: null }, { lockUntil: { $lt: new Date() } }],
    }, { $set: { lockKey: key, lockUntil: new Date(Date.now() + 30000) } }, { returnDocument: 'after' }).lean();
    if (account) break;
    if (Date.now() >= deadline) throw usageError(409, 'USAGE_BUSY', 'Another usage update is in progress. Please retry.', {}, 1);
    await delay(20, undefined, { signal });
  } while (true);
  let lost = false, validUntil = new Date(account.lockUntil).getTime();
  const filter = { _id: userId, lockKey: key };
  const ensure = () => {
    signal?.throwIfAborted();
    if (lost || Date.now() >= validUntil) throw usageError(503, 'USAGE_UNAVAILABLE', 'Usage could not be reserved. Please retry.');
  };
  const heartbeat = setInterval(() => {
    const until = Date.now() + 30000;
    UsageAccount.updateOne({ ...filter, lockUntil: { $gt: new Date() } }, { $set: { lockUntil: new Date(until) } })
      .then(result => { if (!result.matchedCount) lost = true; else validUntil = until; }).catch(() => { lost = true; });
  }, 10000);
  heartbeat.unref();
  try { ensure(); return await operation(ensure, { _id: userId, lockKey: key }); }
  finally {
    clearInterval(heartbeat);
    await UsageAccount.updateOne(filter, { $set: { lockKey: null, lockUntil: null } });
  }
};
module.exports = { withUserLock };
