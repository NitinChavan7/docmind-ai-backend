const { createHash, randomUUID } = require('crypto');
const limits = require('../../config/usage-limits');
const { generationTimeoutMs } = require('../../config/generation');
const { Document, Chat, Message, QuestionUsage, UsageAccount } = require('../database');
const { withUserLock } = require('./lock.service');
const { availableFilter, utcWindow } = require('./resources');
const { usageError } = require('./errors');

const chargeFilter = (now = new Date()) => ({ $or: [
  { status: { $in: ['started', 'completed', 'failed'] } },
  { status: 'reserved', generationUntil: { $gt: now } },
] });
const activeDocuments = (userId, now = new Date()) => ({ userId, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });
const resourceUsage = async (userId, now = new Date()) => {
  // Pending uploads and unexpired deletion jobs retain capacity until removal.
  const documents = await Document.find(activeDocuments(userId, now)).select('_id fileSize').lean();
  if (documents.some(item => !Number.isSafeInteger(item.fileSize) || item.fileSize < 0)) throw usageError(503, 'USAGE_UNAVAILABLE', 'Some legacy PDF sizes need to be verified before storage usage can be calculated.');
  const chatCount = await Chat.countDocuments({ userId, documentId: { $in: documents.map(item => item._id) }, ...availableFilter(now) });
  return { pdfCount: documents.length, totalStorageBytes: documents.reduce((sum, item) => sum + item.fileSize, 0), chatCount };
};
const questionsToday = async (userId, now = new Date()) => {
  const { start, resetAt } = utcWindow(now);
  const [entries, oldMessages] = await Promise.all([
    QuestionUsage.find({ userId, acceptedAt: { $gte: start, $lt: resetAt }, ...chargeFilter(now) }).select('requestKey').lean(),
    Message.find({ userId, role: 'user', committed: true, createdAt: { $gte: start, $lt: resetAt } }).select('chatId requestId').lean(),
  ]);
  const keys = new Set(entries.map(item => item.requestKey));
  for (const item of oldMessages) keys.add(`chat:${item.chatId}:${item.requestId}`);
  return keys.size;
};
const chatQuestionCount = async (userId, chatId, now = new Date()) => {
  const savedIds = await Message.distinct('requestId', { userId, chatId, role: 'user', committed: true });
  const additional = await QuestionUsage.countDocuments({ userId, chatId, requestId: { $nin: savedIds }, ...chargeFilter(now) });
  return savedIds.length + additional;
};
const getUsage = async userId => withUserLock(userId, async () => {
  const now = new Date();
  const usage = { ...await resourceUsage(userId, now), questionsToday: await questionsToday(userId, now) };
  const { DAY_MS, ...publicLimits } = limits;
  return { plan: 'free', limits: publicLimits, usage, remaining: {
    pdfs: Math.max(0, limits.maxPdfs - usage.pdfCount),
    storageBytes: Math.max(0, limits.maxTotalStorageBytes - usage.totalStorageBytes),
    chats: Math.max(0, limits.maxChats - usage.chatCount),
    questionsToday: Math.max(0, limits.maxDailyQuestions - usage.questionsToday),
  }, dailyResetAt: utcWindow(now).resetAt };
});
const reserveUpload = async (userId, data) => withUserLock(userId, async ensure => {
  const existing = await Document.findOne({ userId, contentHash: data.contentHash, ...availableFilter() }).lean();
  if (existing) {
    if (existing.uploadState === 'pending') throw usageError(409, 'UPLOAD_IN_PROGRESS', 'This PDF is already being uploaded. Please retry shortly.', {}, 2);
    return { document: existing, duplicate: true };
  }
  const usage = await resourceUsage(userId);
  if (usage.pdfCount >= limits.maxPdfs) throw usageError(409, 'PDF_COUNT_LIMIT_REACHED', `You can keep up to ${limits.maxPdfs} active PDFs.`, { limit: limits.maxPdfs, used: usage.pdfCount });
  if (usage.totalStorageBytes + data.fileSize > limits.maxTotalStorageBytes) throw usageError(409, 'TOTAL_STORAGE_LIMIT_REACHED', 'This PDF would exceed your storage allowance.', { limit: limits.maxTotalStorageBytes, used: usage.totalStorageBytes });
  ensure();
  const createdAt = new Date();
  const document = await Document.create({ ...data, userId, createdAt, expiresAt: new Date(createdAt.getTime() + limits.pdfRetentionDays * limits.DAY_MS), uploadState: 'pending', uploadUntil: new Date(Date.now() + 600000) });
  return { document: document.toObject(), duplicate: false };
});
const createChat = async (userId, documentId) => withUserLock(userId, async ensure => {
  const usage = await resourceUsage(userId);
  if (usage.chatCount >= limits.maxChats) throw usageError(409, 'CHAT_LIMIT_REACHED', `You can keep up to ${limits.maxChats} active conversations.`, { limit: limits.maxChats, used: usage.chatCount });
  ensure();
  const createdAt = new Date();
  return Chat.create({ userId, documentId, createdAt, expiresAt: new Date(createdAt.getTime() + limits.chatRetentionDays * limits.DAY_MS) });
});

const withQuestionQuota = async (input, operation, { signal, cacheResult = false } = {}) => {
  const { userId, documentId, chatId = null, requestId, question } = input;
  const requestKey = chatId ? `chat:${chatId}:${requestId}` : `rag:${requestId}`;
  const questionHash = createHash('sha256').update(`${documentId}\n${question}`).digest('hex');
  const generationKey = randomUUID();
  const leaseMs = generationTimeoutMs() + 30000;
  const reserved = await withUserLock(userId, async (ensure, lease) => {
    const now = new Date();
    const existing = await QuestionUsage.findOne({ userId, requestKey }).select('+result').lean();
    if (existing) {
      if (existing.questionHash !== questionHash) throw usageError(409, 'REQUEST_ID_CONFLICT', 'Request ID already used for another question.');
      if (existing.status === 'completed' && cacheResult && existing.result) return { replay: true, result: existing.result };
      const retryable = existing.status === 'released' || (existing.status === 'reserved' && existing.generationUntil <= now);
      if (!retryable) throw usageError(409, 'REQUEST_ALREADY_ACCEPTED', 'This question was already accepted. Reload the conversation before retrying.');
    }
    const live = await QuestionUsage.countDocuments({ userId, generationUntil: { $gt: now } });
    if (live >= limits.maxConcurrentGenerations) throw usageError(429, 'GENERATION_ALREADY_RUNNING', 'An answer is already being prepared for your account.', { limit: limits.maxConcurrentGenerations }, 2);
    if (chatId) {
      const count = await chatQuestionCount(userId, chatId, now);
      if (count >= limits.maxQuestionsPerChat) throw usageError(409, 'CHAT_QUESTION_LIMIT_REACHED', `This conversation has reached ${limits.maxQuestionsPerChat} questions.`, { limit: limits.maxQuestionsPerChat, used: count });
    }
    const { resetAt } = utcWindow(now);
    const today = await questionsToday(userId, now);
    if (today >= limits.maxDailyQuestions) throw usageError(429, 'DAILY_AI_LIMIT_REACHED', `You have used all ${limits.maxDailyQuestions} AI questions for today.`, { limit: limits.maxDailyQuestions, used: today, resetAt }, (resetAt - now) / 1000);
    const account = await UsageAccount.findById(userId).select('requestTimes').lean();
    const recent = (account.requestTimes || []).filter(time => time.getTime() > now.getTime() - 60000).sort((a, b) => a - b);
    if (recent.length >= limits.maxChatRequestsPerMinute) {
      const retryAfter = Math.max(1, Math.ceil((recent[recent.length - limits.maxChatRequestsPerMinute].getTime() + 60000 - now) / 1000));
      throw usageError(429, 'CHAT_RATE_LIMIT_REACHED', `Please wait before sending another question. The limit is ${limits.maxChatRequestsPerMinute} per minute.`, { limit: limits.maxChatRequestsPerMinute, resetAt: new Date(now.getTime() + retryAfter * 1000) }, retryAfter);
    }
    ensure();
    // Keep attempts separate from the idempotency ledger: a released request
    // may retry its ID, but each new admission still consumes the minute limit.
    const admitted = await UsageAccount.updateOne({ ...lease, lockUntil: { $gt: new Date() } }, { $set: { requestTimes: [...recent, now] } });
    if (!admitted.matchedCount) throw usageError(503, 'USAGE_UNAVAILABLE', 'Usage could not be reserved. Please retry.');
    ensure();
    const data = { userId, documentId, chatId, requestId, requestKey, questionHash, generationKey,
      status: 'reserved', acceptedAt: now, dailyResetAt: resetAt, generationUntil: new Date(now.getTime() + leaseMs),
      expiresAt: new Date(now.getTime() + (Math.max(limits.chatRetentionDays, limits.pdfRetentionDays, 2) + 1) * limits.DAY_MS) };
    if (existing) await QuestionUsage.updateOne({ _id: existing._id }, { $set: data, $unset: { result: 1 } });
    else await QuestionUsage.create(data);
    return { replay: false };
  }, { signal });
  if (reserved.replay) return reserved.result;

  const controller = new AbortController();
  const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(generationTimeoutMs()), ...(signal ? [signal] : [])]);
  const filter = { userId, requestKey, generationKey };
  let started = false, completed = false;
  const markStarted = async () => {
    combined.throwIfAborted();
    if (started) return;
    const update = await QuestionUsage.updateOne({ ...filter, status: 'reserved', generationUntil: { $gt: new Date() } }, { $set: { status: 'started' } });
    if (!update.matchedCount) throw usageError(503, 'USAGE_UNAVAILABLE', 'The generation reservation expired. Please retry.');
    started = true;
  };
  const heartbeat = setInterval(() => {
    QuestionUsage.updateOne({ ...filter, generationUntil: { $gt: new Date() } }, { $set: { generationUntil: new Date(Date.now() + leaseMs) } })
      .then(result => { if (!result.matchedCount) controller.abort(new Error('Generation lease lost')); })
      .catch(() => controller.abort(new Error('Generation lease lost')));
  }, 10000);
  heartbeat.unref();
  try {
    combined.throwIfAborted();
    const result = await operation({ signal: combined, onGenerationStart: markStarted });
    // Successful deterministic fallbacks also count as accepted questions.
    if (!started) await markStarted();
    await QuestionUsage.updateOne(filter, { $set: { status: 'completed', generationUntil: null, ...(cacheResult ? { result } : {}) } });
    completed = true;
    return result;
  } finally {
    clearInterval(heartbeat);
    controller.abort();
    if (!completed) await QuestionUsage.updateOne(filter, { $set: { status: started ? 'failed' : 'released', generationUntil: null } });
  }
};
module.exports = { getUsage, reserveUpload, createChat, withQuestionQuota, questionsToday, chatQuestionCount };
