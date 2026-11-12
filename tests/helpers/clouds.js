// Install before importing app/controllers. Never construct real cloud clients.
const storagePath = require.resolve('../../modules/document/services/storage.service');
const vectorPath = require.resolve('../../modules/rag/services/vector.service');
const files = new Map();
const calls = { uploads: [], downloads: [], storageDeletes: [], vectorDeletes: [], indexing: [] };
const faults = { upload: false, storageDelete: false, vectorDelete: false };
const storage = {
  uploadPdf: async (key, buffer) => { calls.uploads.push(key); files.set(key, Buffer.from(buffer)); if (faults.upload) throw new Error('Simulated storage upload failure'); return key; },
  downloadPdf: async key => { calls.downloads.push(key); if (!files.has(key)) throw new Error('Missing object'); return files.get(key); },
  deletePdf: async key => { calls.storageDeletes.push(key); if (faults.storageDelete) throw new Error('Simulated storage delete failure'); files.delete(key); },
};
const vector = {
  storeDocumentChunks: async (chunks, userId) => { calls.indexing.push({ chunks, userId }); return { storedChunks: chunks.length }; },
  deleteDocumentChunks: async (documentId, userId) => { calls.vectorDeletes.push({ documentId, userId }); if (faults.vectorDelete) throw new Error('Simulated vector delete failure'); },
  searchDocumentChunks: async () => [],
};
for (const [filename, exports] of [[storagePath, storage], [vectorPath, vector]]) require.cache[filename] = { id: filename, filename, loaded: true, exports };
const reset = () => { files.clear(); Object.values(calls).forEach(items => { items.length = 0; }); Object.keys(faults).forEach(key => { faults[key] = false; }); };
module.exports = { files, calls, faults, storage, vector, reset };
