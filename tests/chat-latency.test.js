const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Exercise real authentication, leases and persistence without cloud requests.
const ragPath = require.resolve('../modules/rag/services/rag.service');
const result = { answer: 'Acme is listed on page 1.', sources: [{ pageNumber: 1 }] };
let generations = 0;
require.cache[ragPath] = { id: ragPath, filename: ragPath, loaded: true, exports: {
  askDocument: async () => { generations++; return result; },
  streamDocument: async (documentId, question, history, options) => {
    generations++;
    await options.onStatus('retrieving');
    if (question === 'fail upstream') throw new Error('Simulated upstream failure');
    await options.onSources(result.sources);
    await options.onToken(result.answer);
    return result;
  },
} };
const models = require('../modules/database');
const { requireAuth } = require('../middleware/auth.middleware');
const tokens = require('../modules/auth/services/token.service');
const controller = require('../modules/chat/controller');

test('optimized chat path retains ownership, revocation, persistence and stream errors', async t => {
  process.env.JWT_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
  process.env.JWT_REFRESH_SECRET = crypto.randomBytes(48).toString('hex');
  const mongo = await MongoMemoryServer.create();
  t.after(async () => { await mongoose.disconnect(); await mongo.stop(); });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(models).map(model => model.init()));
  const user = await models.User.create({ name: 'A', email: 'a@example.com', provider: 'local' });
  const other = await models.User.create({ name: 'B', email: 'b@example.com', provider: 'local' });
  let access;
  await tokens.createSession(user._id, { cookie: (key, value) => { if (key === 'accessToken') access = value; } });
  const document = await models.Document.create({ userId: user._id, originalName: 'a.pdf', fileName: 'a.pdf', filePath: `${user._id}/a.pdf`, mimeType: 'application/pdf', fileSize: 10, status: 'ready' });
  const chat = await models.Chat.create({ userId: user._id, documentId: document._id });
  const app = express();
  app.use(express.json(), (req, res, next) => { req.cookies = { accessToken: req.get('X-Test-Token') }; next(); }, requireAuth);
  app.post('/:chatId/messages', (req, res, next) => controller.ask(req, res).catch(next));
  app.post('/:chatId/stream', (req, res, next) => controller.stream(req, res).catch(next));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
  const ask = (id, question = 'Which companies are listed in the PDF?') => request(app).post(`/${id}/messages`).set('X-Test-Token', access).send({ question, requestId: 'stable-request-id' });

  await t.test('session and account checks start together instead of waiting on one another', async t => {
    let resolveSession, resolveUser;
    let sessionStarted = false, userStarted = false, authenticated = false;
    t.mock.method(models.AuthSession, 'exists', () => {
      sessionStarted = true;
      return new Promise(resolve => { resolveSession = resolve; });
    });
    t.mock.method(models.User, 'exists', () => {
      userStarted = true;
      return new Promise(resolve => { resolveUser = resolve; });
    });
    const pending = requireAuth({ cookies: { accessToken: access } }, { set() {} }, () => { authenticated = true; });
    assert.equal(sessionStarted, true);
    assert.equal(userStarted, true);
    resolveSession({ _id: 'session' });
    resolveUser({ _id: user._id });
    await pending;
    assert.equal(authenticated, true);
  });
  await t.test('ready owned document saves a complete turn and retries avoid generation', async () => {
    assert.equal((await ask(chat._id)).status, 200);
    assert.equal((await ask(chat._id)).status, 200);
    assert.equal(generations, 1);
    assert.equal(await models.Message.countDocuments({ chatId: chat._id, committed: true }), 2);
  });
  await t.test('missing and foreign documents are rejected by the lease before generation', async () => {
    const foreignDoc = await models.Document.create({ userId: other._id, originalName: 'b.pdf', fileName: 'b.pdf', filePath: `${other._id}/b.pdf`, mimeType: 'application/pdf', fileSize: 10, status: 'ready' });
    for (const documentId of [new mongoose.Types.ObjectId(), foreignDoc._id]) {
      const orphan = await models.Chat.create({ userId: user._id, documentId });
      assert.equal((await ask(orphan._id)).status, 404);
    }
    const foreignChat = await models.Chat.create({ userId: other._id, documentId: foreignDoc._id });
    assert.equal((await ask(foreignChat._id)).status, 404);
    assert.equal(generations, 1);
  });
  await t.test('stream saves before done and retains the reserved message ID', async () => {
    const response = await request(app).post(`/${chat._id}/stream`).set('X-Test-Token', access).send({ question: 'Stream an answer' });
    assert.equal(response.status, 200);
    assert.match(response.text, /event: done/);
    const done = JSON.parse(response.text.match(/event: done\ndata: (.+)/)[1]);
    const saved = await models.Message.findById(done.messageId);
    assert.equal(saved.content, result.answer);
    assert.equal(saved.committed, true);
  });
  await t.test('upstream error produces an SSE error and releases the document lease', async () => {
    const before = await models.Message.countDocuments({ chatId: chat._id });
    const response = await request(app).post(`/${chat._id}/stream`).set('X-Test-Token', access).send({ question: 'fail upstream' });
    assert.match(response.text, /event: error/);
    assert.doesNotMatch(response.text, /event: done/);
    assert.equal(await models.Message.countDocuments({ chatId: chat._id }), before);
    assert.equal((await models.Document.findById(document._id)).operationKey, null);
  });
  await t.test('deleting a session immediately revokes access', async () => {
    await models.AuthSession.deleteMany({ userId: user._id });
    assert.equal((await ask(chat._id)).status, 401);
  });
});
