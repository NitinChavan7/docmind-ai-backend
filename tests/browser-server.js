// Isolated browser-test server: real auth/database/files, deterministic RAG.
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
process.env.JWT_ACCESS_SECRET = crypto.randomBytes(64).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(64).toString('hex');
process.env.CLIENT_URL = 'http://localhost:5174';
process.env.NODE_ENV = 'test';
const vector = require('../modules/rag/services/vector.service');
vector.storeDocumentChunks = async chunks => ({ storedChunks: chunks.length });
vector.deleteDocumentChunks = async () => {};
require('../modules/rag/services/embedding.service').generateEmbeddings = async texts => texts.map(() => [0.1, 0.2]);
require('../modules/rag/services/rag.service').askDocument = async (documentId, question, history) => {
  await new Promise(resolve => setTimeout(resolve, 400));
  return { answer: `Saved answer: ${question}. Previous messages: ${history.length}.`, sources: [{ documentId, pageNumber: 1 }] };
};
const app = require('../app');
const { Document } = require('../modules/database');
(async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(require('../modules/database')).map(model => model.init()));
  const server = app.listen(5101, '127.0.0.1', () => console.log('Isolated browser-test API ready at http://localhost:5101'));
  const stop = async () => {
    const fs = require('fs/promises');
    for (const doc of await Document.find().lean()) await fs.unlink(doc.filePath).catch(() => {});
    server.close();
    await mongoose.disconnect(); await mongo.stop(); process.exit(0);
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch(error => { console.error(error); process.exit(1); });
