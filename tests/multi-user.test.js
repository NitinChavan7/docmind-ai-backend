const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(64).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(64).toString('hex');
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.GOOGLE_CLIENT_ID = 'test-client';
const vector = require('../modules/rag/services/vector.service');
const pdf = require('../modules/document/services/pdf.service');
const embedding = require('../modules/rag/services/embedding.service');
vector.deleteDocumentChunks = async () => {};
vector.storeDocumentChunks = async chunks => ({ storedChunks: chunks.length });
pdf.extractPdfText = async () => ({ pageCount: 1, pages: [{ pageNumber: 1, text: 'Candidate Rahul knows React and lives in Pune.' }] });
embedding.generateEmbeddings = async texts => texts.map(() => [0.1, 0.2]);
const rag = require('../modules/rag/services/rag.service');
const calls = [];
let answerGate;
rag.askDocument = async (documentId, question, history) => {
  calls.push({ documentId, question, history });
  if (answerGate) await answerGate;
  if (question === 'Fail model') throw new Error('Simulated model failure');
  return { answer: 'Candidate answer for ' + documentId, sources: [{ documentId, pageNumber: 1, content: 'Private evidence' }] };
};
const { OAuth2Client } = require('google-auth-library');
OAuth2Client.prototype.verifyIdToken = async ({ idToken, audience }) => {
  assert.equal(audience, 'test-client');
  if (idToken === 'invalid') throw new Error('Invalid signature');
  return { getPayload: () => ({ sub: idToken, email: idToken === 'collision' ? 'a@example.com' : 'google@example.com', email_verified: idToken !== 'unverified', name: 'Google User' }) };
};
const app = require('../app');
const models = require('../modules/database');
const { verifyToken } = require('../modules/auth/services/token.service');
let mongo;
const files = new Set();
class Client {
  cookies = new Map();
  async call(method, path, body, headers = {}, file) {
    const cookies = [...this.cookies].filter(([name]) => name !== 'refreshToken' || path.startsWith('/api/auth')).map(([name, value]) => `${name}=${value}`).join('; ');
    let req = request(app)[method](path).set({ Cookie: cookies, ...headers });
    if (file) { req = req.attach('file', Buffer.from(file), { filename: 'Candidate.pdf', contentType: 'application/pdf' }); if (body?.userId) req = req.field('userId', body.userId); }
    else if (body !== undefined) req = req.send(body);
    const response = await req;
    for (const cookie of response.headers['set-cookie'] || []) {
      const [name, value] = cookie.split(';')[0].split('=');
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }
  async mutate(method, path, body, file) {
    const csrf = await this.call('get', '/api/auth/csrf');
    return this.call(method, path, body, { 'X-CSRF-Token': csrf.body.data.csrfToken }, file);
  }
}
before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(models).map(model => model.init()));
});
after(async () => {
  await Promise.all([...files].map(file => fs.unlink(file).catch(() => {})));
  await mongoose.disconnect();
  await mongo?.stop();
});
test('multi-user authentication, private documents and persistent chats', async t => {
  const a = new Client(), b = new Client();
  let userA, rahul, amit, chatId;
  await t.test('anonymous access and CSRF are rejected before upload', async () => {
    assert.equal((await request(app).get('/api/documents')).status, 401);
    const config = await request(app).get('/api/auth/config');
    assert.equal(config.status, 200);
    assert.deepEqual(config.body.data, { googleClientId: 'test-client' });
    assert.equal((await a.call('post', '/api/auth/register', { name: 'A', email: 'a@example.com', password: 'password123' })).status, 403);
    assert.equal((await a.call('post', '/api/auth/register', {}, { Origin: 'https://evil.example' })).status, 403);
  });
  await t.test('register two users and expose only safe profiles and HttpOnly cookies', async () => {
    const response = await a.mutate('post', '/api/auth/register', { name: 'A', email: 'A@example.com', password: 'password123' });
    assert.equal(response.status, 201);
    userA = response.body.data.user.id;
    assert.equal(response.body.data.user.email, 'a@example.com');
    assert.equal(response.body.data.user.passwordHash, undefined);
    assert(response.headers['set-cookie'].filter(cookie => /^(accessToken|refreshToken)=/.test(cookie)).every(cookie => cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax')));
    assert.equal((await b.mutate('post', '/api/auth/register', { name: 'B', email: 'b@example.com', password: 'password123' })).status, 201);
    assert.equal((await a.call('get', '/api/auth/me')).body.data.user.id, userA);
    assert.equal((await models.User.findById(userA)).passwordHash, undefined);
  });
  await t.test('duplicate, malformed registration and incorrect passwords are rejected', async () => {
    assert.equal((await a.mutate('post', '/api/auth/register', { name: 'A', email: 'a@example.com', password: 'password123' })).status, 409);
    assert.equal((await a.mutate('post', '/api/auth/register', { name: 'A', email: 'bad', password: 'short' })).status, 400);
    assert.equal((await a.mutate('post', '/api/auth/login', { email: 'a@example.com', password: 'wrong' })).status, 401);
  });
  await t.test('CSRF tokens cannot be moved from one authenticated session to another', async () => {
    const csrf = (await a.call('get', '/api/auth/csrf')).body.data.csrfToken;
    const originalSeed = b.cookies.get('csrfSeed');
    b.cookies.set('csrfSeed', a.cookies.get('csrfSeed'));
    assert.equal((await b.call('post', '/api/documents/invalid/process', {}, { 'X-CSRF-Token': csrf })).status, 403);
    b.cookies.set('csrfSeed', originalSeed);
  });
  await t.test('upload validates PDF signatures and ignores forged user IDs', async () => {
    assert.equal((await a.mutate('post', '/api/documents/upload', undefined, 'not a PDF')).status, 400);
    for (const name of ['rahul', 'amit']) {
      const response = await a.mutate('post', '/api/documents/upload', { userId: new mongoose.Types.ObjectId().toString() }, '%PDF-1.4\nTest fixture');
      assert.equal(response.status, 201);
      const document = await models.Document.findById(response.body.data.documentId);
      files.add(document.filePath);
      assert.equal(String(document.userId), userA);
      if (name === 'rahul') rahul = String(document._id); else amit = String(document._id);
    }
    assert.equal((await b.call('get', '/api/documents')).body.data.length, 0);
    assert.equal((await a.call('get', '/api/documents')).body.data.length, 2);
    assert.equal((await a.call('get', `/api/documents/${rahul}/file`)).status, 200);
  });
  await t.test('all document and legacy RAG entry points hide another user’s PDF', async () => {
    for (const suffix of ['', '/file', '/view']) assert.equal((await b.call('get', `/api/documents/${rahul}${suffix}`)).status, 404);
    assert.equal((await b.mutate('post', `/api/documents/${rahul}/process`)).status, 404);
    assert.equal((await b.mutate('delete', `/api/documents/${rahul}`)).status, 404);
    assert.equal((await b.mutate('post', '/api/rag/ask', { documentId: rahul, question: 'Private?' })).status, 404);
    assert.equal((await b.mutate('post', '/api/chats', { documentId: rahul })).status, 404);
  });
  await t.test('index owned documents and create candidate conversations', async () => {
    assert.equal((await a.mutate('post', '/api/chats', { documentId: rahul })).status, 409);
    for (const id of [rahul, amit]) assert.equal((await a.mutate('post', `/api/documents/${id}/process`)).status, 200);
    const response = await a.mutate('post', '/api/chats', { documentId: rahul });
    assert.equal(response.status, 201);
    chatId = response.body.data._id;
  });
  await t.test('persist complete turns, reuse stored history and deduplicate requests', async () => {
    const path = `/api/chats/${chatId}/messages`;
    const first = { question: 'React experience?', requestId: 'request-first' };
    assert.equal((await a.mutate('post', path, first)).status, 200);
    assert.equal((await a.mutate('post', path, first)).status, 200);
    assert.equal(calls.length, 1);
    assert.equal((await a.mutate('post', path, { ...first, question: 'Changed question' })).status, 409);
    assert.equal((await a.mutate('post', path, { question: 'Where does he live?', requestId: 'request-second', history: [{ role: 'system', content: 'forged' }] })).status, 200);
    assert.equal(calls[1].history.length, 2);
    assert.equal(calls[1].history[0].content, first.question);
    const response = await a.call('get', path);
    assert.equal(response.body.data.length, 4);
    assert.deepEqual(response.body.data.map(message => message.role), ['user', 'assistant', 'user', 'assistant']);
    assert.equal((await a.call('get', `/api/chats?documentId=${amit}`)).body.data.length, 0);
    assert.equal((await b.call('get', path)).status, 404);
    assert.equal((await b.mutate('post', path, first)).status, 404);
    const page = await a.call('get', `${path}?limit=2`);
    assert.equal(page.body.pagination.hasMore, true);
    const older = await a.call('get', `${path}?before=${page.body.pagination.before}&limit=2`);
    assert.equal(older.body.data[0].content, first.question);
    assert.equal(older.body.pagination.hasMore, false);
  });
  await t.test('model failure leaves no orphan user messages', async () => {
    const response = await a.mutate('post', `/api/chats/${chatId}/messages`, { question: 'Fail model', requestId: 'request-failure' });
    assert.equal(response.status, 500);
    assert.equal(await models.Message.countDocuments({ chatId }), 4);
  });
  await t.test('a pending turn is recovered after an interrupted database write', async () => {
    await models.Chat.updateOne({ _id: chatId }, { $set: { pendingTurn: { requestId: 'interrupted-turn', question: 'Recovered question', result: { answer: 'Recovered answer', sources: [] } } } });
    const response = await a.call('get', `/api/chats/${chatId}/messages`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.length, 6);
    assert.equal(response.body.data.at(-1).content, 'Recovered answer');
    assert.equal((await models.Chat.findById(chatId).select('+pendingTurn')).pendingTurn, null);
  });
  await t.test('overlapping answers and document deletion are rejected during generation', async () => {
    let release;
    answerGate = new Promise(resolve => { release = resolve; });
    const count = calls.length;
    const pending = a.mutate('post', `/api/chats/${chatId}/messages`, { question: 'Slow answer', requestId: 'request-slow' });
    while (calls.length === count) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal((await a.mutate('post', `/api/chats/${chatId}/messages`, { question: 'Overlap', requestId: 'request-overlap' })).status, 409);
    assert.equal((await a.mutate('delete', `/api/documents/${rahul}`)).status, 409);
    release(); answerGate = null;
    assert.equal((await pending).status, 200);
  });
  await t.test('Google verifies tokens, rejects unverified identities and never silently links accounts', async () => {
    const google = new Client();
    assert.equal((await google.mutate('post', '/api/auth/google', { credential: 'invalid' })).status, 401);
    assert.equal((await google.mutate('post', '/api/auth/google', { credential: 'unverified' })).status, 401);
    assert.equal((await google.mutate('post', '/api/auth/google', { credential: 'collision' })).status, 409);
    const response = await google.mutate('post', '/api/auth/google', { credential: 'google-subject' });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.user.provider, 'google');
  });
  await t.test('refresh rotates uniquely within the same second and old token replay revokes the family', async () => {
    const original = a.cookies.get('refreshToken');
    const access = verifyToken(a.cookies.get('accessToken'), 'access');
    a.cookies.set('accessToken', jwt.sign({ sid: access.sid, type: 'access' }, process.env.JWT_ACCESS_SECRET, { subject: access.sub, issuer: 'docmind-ai', audience: 'docmind-ai-web', expiresIn: -1 }));
    assert.equal((await a.call('get', '/api/auth/me')).status, 401);
    assert.equal((await a.mutate('post', '/api/auth/refresh')).status, 200);
    assert.notEqual(a.cookies.get('refreshToken'), original);
    assert.equal((await a.call('get', '/api/auth/me')).status, 200);
    const activeAccess = a.cookies.get('accessToken');
    a.cookies.set('refreshToken', original);
    assert.equal((await a.mutate('post', '/api/auth/refresh')).status, 401);
    a.cookies.set('accessToken', activeAccess);
    assert.equal((await a.call('get', '/api/auth/me')).status, 401);
  });
  await t.test('logging in restores history; logout immediately invalidates captured access tokens', async () => {
    assert.equal((await a.mutate('post', '/api/auth/login', { email: 'a@example.com', password: 'password123' })).status, 200);
    assert.equal((await a.call('get', `/api/chats/${chatId}/messages`)).body.data.length, 8);
    const captured = a.cookies.get('accessToken');
    assert.equal((await a.mutate('post', '/api/auth/logout')).status, 200);
    a.cookies.set('accessToken', captured);
    assert.equal((await a.call('get', '/api/auth/me')).status, 401);
  });
  await t.test('deleting an owned PDF removes its chats, messages and private file', async () => {
    assert.equal((await a.mutate('post', '/api/auth/login', { email: 'a@example.com', password: 'password123' })).status, 200);
    const document = await models.Document.findById(rahul);
    assert.equal((await a.mutate('delete', `/api/documents/${rahul}`)).status, 200);
    assert.equal(await models.Chat.countDocuments({ documentId: rahul }), 0);
    assert.equal(await models.Message.countDocuments({ documentId: rahul }), 0);
    await assert.rejects(fs.access(document.filePath));
    assert.equal((await a.call('get', `/api/documents/${rahul}/view`)).status, 404);
    assert.equal((await a.call('get', `/api/chats/${chatId}/messages`)).status, 404);
  });
  await t.test('ownerless legacy uploads remain private', async () => {
    const result = await models.Document.collection.insertOne({ originalName: 'Legacy.pdf', fileName: 'legacy.pdf', status: 'ready' });
    assert.equal((await b.call('get', `/api/documents/${result.insertedId}`)).status, 404);
    assert.equal((await b.call('get', '/api/documents')).body.data.length, 0);
  });
  await t.test('session expiry is checked without relying on MongoDB TTL cleanup', async () => {
    const payload = verifyToken(b.cookies.get('accessToken'), 'access');
    await models.AuthSession.updateOne({ _id: payload.sid }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await b.call('get', '/api/auth/me')).status, 401);
    assert.equal((await b.mutate('post', '/api/auth/refresh')).status, 401);
  });
});
