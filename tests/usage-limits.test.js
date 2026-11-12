const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { makePdf } = require('./helpers/pdf');
const cloud = require('./helpers/clouds');
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(48).toString('hex');
process.env.NODE_ENV = 'test';
process.env.GENERATION_RATE_LIMIT = '120';
const models = require('../modules/database');
const limits = require('../config/usage-limits');
const usage = require('../modules/usage/usage.service');
const { utcWindow } = require('../modules/usage/resources');
const cleanup = require('../modules/usage/cleanup.service');
const tokens = require('../modules/auth/services/token.service');
const rag = require('../modules/rag/services/rag.service');
const { parseSse } = require('../utils/stream');
let aiCalls = 0;
rag.askDocument = async (documentId, question, history, options) => {
  if (question === 'fail before start') throw new Error('Simulated retrieval failure');
  await options.onGenerationStart();
  aiCalls++;
  if (question === 'fail after start') throw new Error('Simulated provider failure');
  return { answer: 'A supported PDF answer.', sources: [{ documentId, pageNumber: 1 }] };
};
rag.streamDocument = async (documentId, question, history, options) => {
  await options.onStatus('understanding');
  await options.onGenerationStart();
  aiCalls++;
  await options.onSources([{ documentId, pageNumber: 1 }]);
  await options.onStatus('generating');
  await options.onToken('A supported PDF answer.');
  if (question === 'hold stream') {
    await new Promise((resolve, reject) => {
      if (options.signal.aborted) return reject(options.signal.reason);
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  }
  return { answer: 'A supported PDF answer.', sources: [{ documentId, pageNumber: 1 }] };
};
const app = require('../app');
let mongo;
before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(models).map(model => model.init()));
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(models).map(model => model.deleteMany({})));
  cloud.reset(); aiCalls = 0;
});

const client = async () => {
  const user = await models.User.create({ name: 'Test', email: `${crypto.randomUUID()}@example.com`, provider: 'local' });
  const cookies = new Map();
  await tokens.createSession(user._id, { cookie: (name, value) => cookies.set(name, value) });
  const cookie = () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const csrfResponse = await request(app).get('/api/auth/csrf').set('Cookie', cookie());
  for (const item of csrfResponse.headers['set-cookie'] || []) { const [name, value] = item.split(';')[0].split('='); cookies.set(name, value); }
  const csrf = csrfResponse.body.data.csrfToken;
  const headers = () => ({ Cookie: cookie(), Origin: 'http://localhost:5173', 'X-CSRF-Token': csrf });
  return {
    id: user._id, headers,
    get: path => request(app).get(path).set(headers()),
    post: (path, body) => request(app).post(path).set(headers()).send(body),
    delete: path => request(app).delete(path).set(headers()),
    upload: (buffer = makePdf(), mime = 'application/pdf') => request(app).post('/api/documents/upload').set(headers()).attach('file', buffer, { filename: 'test.pdf', contentType: mime }),
  };
};
const seedDocument = async (owner, fields = {}) => {
  const filename = `${crypto.randomUUID()}.pdf`;
  return models.Document.create({ userId: owner.id, originalName: 'test.pdf', fileName: filename, filePath: `${owner.id}/${filename}`, fileSize: 1024, mimeType: 'application/pdf', status: 'ready', ...fields });
};
const seedChat = (owner, document, fields = {}) => models.Chat.create({ userId: owner.id, documentId: document._id, ...fields });
const seedUsage = async (owner, document, count, fields = {}) => {
  const now = new Date();
  return models.QuestionUsage.insertMany(Array.from({ length: count }, (_, index) => ({
    userId: owner.id, documentId: document._id, requestId: `seed-${index}-${crypto.randomUUID()}`, requestKey: `seed:${crypto.randomUUID()}`,
    questionHash: 'seed', status: 'completed', acceptedAt: now, dailyResetAt: utcWindow(now).resetAt,
    generationKey: crypto.randomUUID(), generationUntil: null, expiresAt: new Date(Date.now() + 86400000), ...fields,
  })));
};
const waitFor = async predicate => {
  for (let i = 0; i < 250; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail('Cleanup did not finish');
};

test('quota defaults and invalid environment values fail clearly at startup', () => {
  assert.equal(limits.maxPdfs, 5);
  assert.equal(limits.maxPdfSizeBytes, 10485760);
  for (const value of ['0', '-1', 'NaN', '', '1.5', 'Infinity']) {
    const result = spawnSync(process.execPath, ['-e', "require('./config/usage-limits')"], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, FREE_MAX_PDFS: value }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FREE_MAX_PDFS must be a positive integer/);
  }
});

test('valid PDF size boundaries are inclusive; oversized uploads never reach Supabase', async () => {
  const a = await client();
  const { inspectPdfBuffer } = require('../modules/document/services/pdf.service');
  assert.equal(await inspectPdfBuffer(makePdf(1, 'Below limit', limits.maxPdfSizeBytes - 1)), 1);
  const accepted = await a.upload(makePdf(1, 'Exact limit', limits.maxPdfSizeBytes));
  assert.equal(accepted.status, 201, accepted.text);
  assert.equal(accepted.body.data.fileSize, limits.maxPdfSizeBytes);
  const rejected = await a.upload(makePdf(1, 'Over limit', limits.maxPdfSizeBytes + 1));
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.code, 'PDF_SIZE_LIMIT_EXCEEDED');
  assert.equal(cloud.calls.uploads.length, 1);
});

test('empty, wrong-MIME, bad-signature and malformed PDFs are rejected before storage', async () => {
  const a = await client();
  for (const [buffer, mime] of [[Buffer.alloc(0), 'application/pdf'], [makePdf(), 'text/plain'], [Buffer.from('not PDF'), 'application/pdf'], [Buffer.from('%PDF-1.4\ninvalid'), 'application/pdf']]) {
    const response = await a.upload(buffer, mime);
    assert.equal(response.status, 400, response.text);
    assert.equal(response.body.code, 'INVALID_PDF_FILE');
  }
  assert.equal(cloud.calls.uploads.length, 0);
  assert.equal(await models.Document.countDocuments(), 0);
});

test('25 pages are accepted and 26 are rejected before indexing or storage', async () => {
  const a = await client();
  assert.equal((await a.upload(makePdf(25))).status, 201);
  const rejected = await a.upload(makePdf(26));
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.code, 'PDF_PAGE_LIMIT_EXCEEDED');
  assert.equal(cloud.calls.uploads.length, 1);
  assert.equal(cloud.calls.indexing.length, 0);
});

test('sixth active PDF is rejected; an identical retry reuses the original record', async () => {
  const a = await client();
  let first;
  for (let i = 0; i < 5; i++) {
    const response = await a.upload(makePdf(1, `File ${i}`));
    assert.equal(response.status, 201, response.text);
    if (i === 0) first = response.body.data.documentId;
  }
  const rejected = await a.upload(makePdf(1, 'Sixth file'));
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'PDF_COUNT_LIMIT_REACHED');
  const retried = await a.upload(makePdf(1, 'File 0'));
  assert.equal(retried.body.data.documentId, first);
  assert.equal(await models.Document.countDocuments({ userId: a.id }), 5);
  assert.equal(cloud.calls.uploads.length, 5);
});

test('total-storage rejection uses server-side bytes and releases capacity after deletion', async () => {
  const a = await client();
  const old = await seedDocument(a, { fileSize: 29 * 1048576 });
  const response = await a.upload(makePdf(1, 'Two MB', 2 * 1048576));
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'TOTAL_STORAGE_LIMIT_REACHED');
  assert.equal(cloud.calls.uploads.length, 0);
  assert.equal((await a.delete(`/api/documents/${old._id}`)).status, 200);
  assert.equal((await a.upload(makePdf(1, 'Two MB', 2 * 1048576))).status, 201);
});

test('concurrent upload reservations cannot exceed the PDF allowance', async () => {
  const a = await client();
  const responses = await Promise.all(Array.from({ length: 7 }, (_, i) => a.upload(makePdf(1, `Concurrent ${i}`))));
  assert.equal(responses.filter(response => response.status === 201).length, 5);
  assert.equal(responses.filter(response => response.body.code === 'PDF_COUNT_LIMIT_REACHED').length, 2);
  const response = await a.get('/api/usage');
  assert.equal(response.body.data.usage.pdfCount, 5);
  assert.equal(response.body.data.remaining.pdfs, 0);
});

test('11 concurrent chat creations across documents cannot exceed 10; deletion releases a slot', async () => {
  const a = await client();
  // Existing accounts can already have more PDFs than the new upload limit.
  const documents = await Promise.all(Array.from({ length: 11 }, () => seedDocument(a)));
  const responses = await Promise.all(documents.map(document => a.post('/api/chats', { documentId: document._id })));
  assert.equal(responses.filter(response => response.status === 201).length, 10);
  assert.equal(responses.filter(response => response.body.code === 'CHAT_LIMIT_REACHED').length, 1);
  const chat = await models.Chat.findOne({ userId: a.id });
  assert.equal((await a.delete(`/api/chats/${chat._id}`)).status, 200);
  assert.equal((await a.post('/api/chats', { documentId: documents[0]._id })).status, 201);
});

test('51st question in a chat is rejected before opening SSE or charging daily usage', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  await models.Message.insertMany(Array.from({ length: 50 }, (_, i) => ({ userId: a.id, documentId: document._id, chatId: chat._id, requestId: `old-${i}`, role: 'user', content: 'Saved question', committed: true, createdAt: new Date(Date.now() - 86400000) })));
  const response = await a.post(`/api/chats/${chat._id}/stream`, { question: 'Another question' });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'CHAT_QUESTION_LIMIT_REACHED');
  assert.match(response.headers['content-type'], /json/);
  assert.equal(await models.QuestionUsage.countDocuments(), 0);
  assert.equal(aiCalls, 0);
});

test('31st daily question is blocked on JSON, SSE and legacy RAG with the same reset time', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  await seedUsage(a, document, 30);
  for (const path of [`/api/chats/${chat._id}/messages`, `/api/chats/${chat._id}/stream`, '/api/rag/ask']) {
    const response = await a.post(path, { documentId: document._id, question: 'Over the daily limit' });
    assert.equal(response.status, 429, response.text);
    assert.equal(response.body.code, 'DAILY_AI_LIMIT_REACHED');
    assert.equal(response.body.details.resetAt, utcWindow().resetAt.toISOString());
    assert.ok(Number(response.headers['retry-after']) > 0);
  }
  assert.equal(aiCalls, 0);
});

test('daily quota resets at UTC midnight, independent of the server timezone', async () => {
  const a = await client(), document = await seedDocument(a);
  await seedUsage(a, document, 30, { acceptedAt: new Date('2026-11-11T23:59:59.999Z') });
  assert.equal(await usage.questionsToday(a.id, new Date('2026-11-11T23:59:59.999Z')), 30);
  assert.equal(await usage.questionsToday(a.id, new Date('2026-11-12T00:00:00.000Z')), 0);
  assert.equal(utcWindow(new Date('2026-11-12T00:00:00.000Z')).resetAt.toISOString(), '2026-11-13T00:00:00.000Z');
});

test('JSON and SSE retries share one request ID, saved turn and quota charge', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  const body = { question: 'What is in the PDF?', requestId: 'same-request-uuid' };
  assert.equal((await a.post(`/api/chats/${chat._id}/messages`, body)).status, 200);
  const replay = await a.post(`/api/chats/${chat._id}/stream`, body);
  assert.match(replay.text, /event: done/);
  assert.equal(aiCalls, 1);
  assert.equal((await a.get('/api/usage')).body.data.usage.questionsToday, 1);
  assert.equal((await a.post(`/api/chats/${chat._id}/messages`, { ...body, question: 'Changed question' })).status, 409);
  assert.equal((await a.post(`/api/chats/${chat._id}/stream`, { question: 'Second question', requestId: 'second-request-uuid' })).status, 200);
  assert.equal((await a.get('/api/usage')).body.data.usage.questionsToday, 2);
});

test('legacy RAG retries are idempotent and share the account allowance', async () => {
  const a = await client(), document = await seedDocument(a);
  const body = { documentId: document._id, question: 'What is in the PDF?', requestId: 'legacy-request-uuid' };
  assert.equal((await a.post('/api/rag/ask', body)).status, 200);
  assert.equal((await a.post('/api/rag/ask', body)).status, 200);
  assert.equal(aiCalls, 1);
  assert.equal((await a.get('/api/usage')).body.data.usage.questionsToday, 1);
});

test('persisted per-user rate limit blocks the sixth request without affecting another user', async () => {
  const a = await client(), b = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  for (let i = 0; i < 5; i++) assert.equal((await a.post(`/api/chats/${chat._id}/messages`, { question: `Question ${i}`, requestId: `rate-request-${i}` })).status, 200);
  const response = await a.post(`/api/chats/${chat._id}/stream`, { question: 'Sixth request' });
  assert.equal(response.status, 429);
  assert.equal(response.body.code, 'CHAT_RATE_LIMIT_REACHED');
  assert.ok(Number(response.headers['retry-after']) > 0);
  assert.equal((await b.get('/api/usage')).body.data.usage.questionsToday, 0);
});

test('retrying a released request ID cannot bypass the per-minute limiter', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  const body = { question: 'fail before start', requestId: 'released-retry-uuid' };
  for (let i = 0; i < 5; i++) assert.equal((await a.post(`/api/chats/${chat._id}/messages`, body)).status, 500);
  assert.equal((await a.post(`/api/chats/${chat._id}/messages`, body)).body.code, 'CHAT_RATE_LIMIT_REACHED');
  assert.equal(await usage.questionsToday(a.id), 0);
});

test('MongoDB generation leases enforce concurrency even without process-local slots', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  await seedUsage(a, document, 1, { status: 'started', generationUntil: new Date(Date.now() + 60000) });
  const response = await a.post(`/api/chats/${chat._id}/messages`, { question: 'Concurrent generation' });
  assert.equal(response.status, 429);
  assert.equal(response.body.code, 'GENERATION_ALREADY_RUNNING');
  assert.equal(aiCalls, 0);
});

test('concurrent quota admissions cannot exceed the last daily slot', async () => {
  const a = await client(), document = await seedDocument(a);
  await seedUsage(a, document, 29, { acceptedAt: new Date(Date.now() - 120000) });
  const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => usage.withQuestionQuota({ userId: a.id, documentId: document._id, requestId: `concurrent-${i}`, question: 'PDF question' }, async options => { await options.onGenerationStart(); return { answer: 'Answer' }; })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await usage.questionsToday(a.id), 30);
});

test('failures before generation release the reservation; failures after start stay charged', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  assert.equal((await a.post(`/api/chats/${chat._id}/messages`, { question: 'fail before start', requestId: 'before-start-uuid' })).status, 500);
  assert.equal(await usage.questionsToday(a.id), 0);
  assert.equal((await models.QuestionUsage.findOne({ userId: a.id })).generationUntil, null);
  assert.equal((await a.post(`/api/chats/${chat._id}/messages`, { question: 'fail after start', requestId: 'after-start-uuid' })).status, 500);
  assert.equal(await usage.questionsToday(a.id), 1);
  const retry = await a.post(`/api/chats/${chat._id}/messages`, { question: 'fail after start', requestId: 'after-start-uuid' });
  assert.equal(retry.status, 409);
  assert.equal(await usage.questionsToday(a.id), 1);
});

test('cancelled streams release both distributed concurrency and the document lease', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const abort = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chats/${chat._id}/stream`, { method: 'POST', signal: abort.signal, headers: { ...a.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'hold stream', requestId: 'cancel-stream-uuid' }) });
    for await (const event of parseSse(response.body)) { if (event.event === 'token') { abort.abort(); break; } }
    await waitFor(async () => (await models.Document.findById(document._id)).operationKey === null && !(await models.QuestionUsage.exists({ userId: a.id, generationUntil: { $ne: null } })));
    assert.equal(await models.Message.countDocuments(), 0);
    assert.equal(await usage.questionsToday(a.id), 1);
    assert.equal((await a.post(`/api/chats/${chat._id}/messages`, { question: 'Next question' })).status, 200);
  } finally { abort.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('expired PDFs cannot be read, viewed, processed, chatted with or queried', async () => {
  const a = await client(), b = await client(), document = await seedDocument(a, { expiresAt: new Date(Date.now() - 1000) }), chat = await seedChat(a, document);
  for (const suffix of ['', '/file', '/view']) {
    const response = await a.get(`/api/documents/${document._id}${suffix}`);
    assert.equal(response.status, 410);
    assert.equal(response.body.code, 'DOCUMENT_EXPIRED');
    assert.equal((await b.get(`/api/documents/${document._id}${suffix}`)).status, 404);
  }
  for (const [path, body] of [[`/api/documents/${document._id}/process`, {}], ['/api/chats', { documentId: document._id }], [`/api/chats/${chat._id}/messages`, { question: 'Question' }], ['/api/rag/ask', { documentId: document._id, question: 'Question' }]]) {
    const response = await a.post(path, body);
    assert.equal(response.status, 410, response.text);
    assert.equal(response.body.code, 'DOCUMENT_EXPIRED');
  }
  assert.equal((await a.get('/api/documents')).body.data.length, 0);
  assert.equal(aiCalls, 0);
  assert.equal(cloud.calls.downloads.length, 0);
});

test('expired chats reject history and generation while the PDF remains available', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await a.get(`/api/chats/${chat._id}/messages`)).body.code, 'CHAT_EXPIRED');
  assert.equal((await a.post(`/api/chats/${chat._id}/stream`, { question: 'Question' })).body.code, 'CHAT_EXPIRED');
  assert.equal((await a.get(`/api/documents/${document._id}`)).status, 200);
  assert.equal((await a.get(`/api/chats?documentId=${document._id}`)).body.data.length, 0);
});

test('deleting a partially indexed PDF removes its vectors, object, chats and messages but preserves daily charges', async () => {
  const a = await client(), document = await seedDocument(a, { status: 'failed' }), chat = await seedChat(a, document);
  cloud.files.set(document.filePath, makePdf());
  await models.Message.create({ userId: a.id, documentId: document._id, chatId: chat._id, requestId: 'old-question', role: 'user', content: 'Question', committed: true });
  await seedUsage(a, document, 1, { chatId: chat._id });
  const chargedBeforeDeletion = await usage.questionsToday(a.id);
  assert.equal((await a.delete(`/api/documents/${document._id}`)).status, 200);
  assert.equal(await models.Document.countDocuments(), 0);
  assert.equal(await models.Chat.countDocuments(), 0);
  assert.equal(await models.Message.countDocuments(), 0);
  assert.equal(cloud.files.size, 0);
  assert.deepEqual(cloud.calls.vectorDeletes[0], { documentId: String(document._id), userId: String(a.id) });
  assert.equal(await usage.questionsToday(a.id), chargedBeforeDeletion);
});

test('cleanup is dry-run by default and retries Qdrant and Supabase failures idempotently', async () => {
  const a = await client(), document = await seedDocument(a, { expiresAt: new Date(Date.now() - 1000) });
  cloud.files.set(document.filePath, makePdf());
  assert.equal((await cleanup.cleanupExpired()).documents, 1);
  assert.equal(cloud.calls.vectorDeletes.length, 0);
  assert.equal(await models.Document.countDocuments(), 1);
  cloud.faults.vectorDelete = true;
  assert.equal((await cleanup.cleanupExpired({ dryRun: false })).failed, 1);
  assert.equal((await models.Document.findById(document._id)).deletionPending, true);
  cloud.faults.vectorDelete = false; cloud.faults.storageDelete = true;
  assert.equal((await cleanup.cleanupExpired({ dryRun: false })).failed, 1);
  cloud.faults.storageDelete = false;
  assert.equal((await cleanup.cleanupExpired({ dryRun: false })).failed, 0);
  assert.equal(await models.Document.countDocuments(), 0);
  assert.equal(cloud.files.size, 0);
  assert.equal((await cleanup.cleanupExpired({ dryRun: false })).documents, 0);
});

test('failed uploads leave retryable cleanup metadata and recover abandoned reservations', async () => {
  const a = await client();
  cloud.faults.upload = true; cloud.faults.storageDelete = true;
  assert.equal((await a.upload(makePdf())).status, 500);
  const staged = await models.Document.findOne({ userId: a.id });
  assert.equal(staged.deletionPending, true);
  assert.equal(staged.uploadState, 'pending');
  assert.equal((await a.get('/api/documents')).body.data.length, 0);
  cloud.faults.upload = false; cloud.faults.storageDelete = false;
  await cleanup.cleanupExpired({ dryRun: false });
  assert.equal(await models.Document.countDocuments(), 0);
  assert.equal(cloud.files.size, 0);
  await seedDocument(a, { uploadState: 'pending', uploadUntil: new Date(Date.now() - 1000) });
  await cleanup.cleanupExpired({ dryRun: false });
  assert.equal(await models.Document.countDocuments(), 0);
});

test('chat-only cleanup removes messages and preserves the parent PDF', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document, { expiresAt: new Date(Date.now() - 1000) });
  await models.Message.create({ userId: a.id, documentId: document._id, chatId: chat._id, requestId: 'chat-message', role: 'user', content: 'Question', committed: true });
  await cleanup.cleanupExpired({ dryRun: false });
  assert.equal(await models.Chat.countDocuments(), 0);
  assert.equal(await models.Message.countDocuments(), 0);
  assert.equal(await models.Document.countDocuments(), 1);
  assert.equal(cloud.calls.vectorDeletes.length, 0);
});

test('legacy retention backfill is explicit, repeatable and skips missing creation timestamps', async () => {
  const a = await client();
  const recent = await seedDocument(a);
  await models.Document.collection.updateOne({ _id: recent._id }, { $unset: { expiresAt: 1 } });
  await models.Document.collection.insertOne({ userId: a.id, originalName: 'Legacy', fileName: 'legacy.pdf', filePath: `${a.id}/legacy.pdf`, fileSize: 1 });
  const { backfill } = require('../scripts/backfill-retention');
  assert.equal((await cleanup.cleanupExpired({ dryRun: false })).documents, 0);
  const preview = await backfill();
  assert.equal(preview.documents, 1);
  assert.equal(preview.skippedWithoutTimestamp, 1);
  assert.equal((await models.Document.findOne({ _id: recent._id }).lean()).expiresAt, undefined);
  await backfill({ apply: true });
  assert.equal((await models.Document.findById(recent._id).lean()).expiresAt.toISOString(), new Date(recent.createdAt.getTime() + 30 * 86400000).toISOString());
  assert.equal((await backfill({ apply: true })).documents, 0);
});

test('usage is authenticated, private, owner-scoped and includes resource expiry timestamps', async () => {
  const a = await client(), b = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  assert.equal((await request(app).get('/api/usage')).status, 401);
  const own = await a.get('/api/usage');
  assert.match(own.headers['cache-control'], /private, no-store/);
  assert.equal(own.body.data.usage.pdfCount, 1);
  assert.equal(own.body.data.usage.chatCount, 1);
  assert.equal((await b.get(`/api/usage?userId=${a.id}`)).body.data.usage.pdfCount, 0);
  assert.ok((await a.get(`/api/documents/${document._id}`)).body.data.expiresAt);
  assert.ok((await a.get(`/api/chats?documentId=${document._id}`)).body.data[0].expiresAt);
  assert.equal((await b.post(`/api/chats/${chat._id}/messages`, { question: 'Question' })).status, 404);
  assert.equal(await models.QuestionUsage.countDocuments(), 0);
});

test('storage accepts exactly the total allowance and rejects the next byte allocation', async () => {
  const a = await client();
  await seedDocument(a, { fileSize: 20 * 1048576 });
  assert.equal((await a.upload(makePdf(1, 'Last ten MB', 10 * 1048576))).status, 201);
  const response = await a.upload(makePdf(1, 'One more PDF'));
  assert.equal(response.body.code, 'TOTAL_STORAGE_LIMIT_REACHED');
  assert.equal((await a.get('/api/usage')).body.data.remaining.storageBytes, 0);
});

test('concurrent admissions cannot exceed the last per-chat question slot', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  await models.Message.insertMany(Array.from({ length: 49 }, (_, i) => ({ userId: a.id, documentId: document._id, chatId: chat._id, requestId: `past-${i}`, role: 'user', content: 'Saved question', committed: true, createdAt: new Date(Date.now() - 86400000) })));
  const results = await Promise.allSettled(Array.from({ length: 4 }, (_, i) => usage.withQuestionQuota({ userId: a.id, documentId: document._id, chatId: chat._id, requestId: `last-slot-${i}`, question: 'Last question' }, async options => { await options.onGenerationStart(); return { answer: 'Answer' }; })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await usage.chatQuestionCount(a.id, chat._id), 50);
});

test('HTTP provider failures before acceptance release quota; accepted completions are charged', async t => {
  const a = await client(), document = await seedDocument(a);
  const { generateAnswer } = require('../modules/rag/services/llm.service');
  const originalKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-only-key';
  t.after(() => { if (originalKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = originalKey; });
  let unavailable = true;
  t.mock.method(globalThis, 'fetch', async () => unavailable ? new Response('{}', { status: 503 }) : Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Answer' } }] }));
  const input = { userId: a.id, documentId: document._id, requestId: 'provider-retry-uuid', question: 'PDF question' };
  await assert.rejects(usage.withQuestionQuota(input, options => generateAnswer('Question', 'PDF context', [], options)));
  assert.equal(await usage.questionsToday(a.id), 0);
  unavailable = false;
  assert.equal(await usage.withQuestionQuota(input, options => generateAnswer('Question', 'PDF context', [], options)), 'Answer');
  assert.equal(await usage.questionsToday(a.id), 1);
});

test('expired pre-generation leases no longer consume daily quota or concurrency', async () => {
  const a = await client(), document = await seedDocument(a), chat = await seedChat(a, document);
  await seedUsage(a, document, 30, { status: 'reserved', generationUntil: new Date(Date.now() - 1000), acceptedAt: new Date(Date.now() - 120000) });
  assert.equal(await usage.questionsToday(a.id), 0);
  assert.equal((await a.post(`/api/chats/${chat._id}/messages`, { question: 'New question' })).status, 200);
  assert.equal(await usage.questionsToday(a.id), 1);
});

test('processing rechecks page count for old files before cloud indexing', async () => {
  const a = await client(), document = await seedDocument(a, { status: 'uploaded' });
  cloud.files.set(document.filePath, makePdf(26));
  const response = await a.post(`/api/documents/${document._id}/process`, {});
  assert.equal(response.status, 413);
  assert.equal(response.body.code, 'PDF_PAGE_LIMIT_EXCEEDED');
  assert.equal(cloud.calls.indexing.length, 0);
});
