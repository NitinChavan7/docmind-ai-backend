// const { ChromaClient } = require("chromadb");

// const chromaUrl = new URL(process.env.CHROMA_URL || 'http://127.0.0.1:8000');
// const clientOptions = {
//   host: chromaUrl.hostname,
//   port: Number(chromaUrl.port || (chromaUrl.protocol === 'https:' ? 443 : 80)),
//   ssl: chromaUrl.protocol === 'https:',
// };
// const client = new ChromaClient(clientOptions);

// const COLLECTION_NAME = process.env.CHROMA_COLLECTION || "document_chunks";

// const getVectorCollection = async ({ signal } = {}) => {
//   signal?.throwIfAborted();
//   const requestClient = signal ? new ChromaClient({ ...clientOptions, fetchOptions: { signal } }) : client;
//   return await requestClient.getOrCreateCollection({
//     name: COLLECTION_NAME,
//     embeddingFunction: null,
//   });
// };

// // Save PDF chunks and embeddings
// const storeDocumentChunks = async (chunks, embeddings) => {
//   if (
//     !Array.isArray(chunks) ||
//     chunks.length === 0 ||
//     !Array.isArray(embeddings) ||
//     chunks.length !== embeddings.length
//   ) {
//     throw new Error("Invalid chunks or embeddings");
//   }

//   const collection = await getVectorCollection();

//   const ids = chunks.map(
//     (chunk) =>
//       `${chunk.documentId}_page${chunk.pageNumber}_chunk${chunk.chunkNumber}`,
//   );

//   const documents = chunks.map((chunk) => chunk.content);

//   const metadatas = chunks.map((chunk) => ({
//     documentId: String(chunk.documentId),
//     pageNumber: chunk.pageNumber,
//     chunkNumber: chunk.chunkNumber,
//   }));

//   await collection.upsert({
//     ids,
//     documents,
//     embeddings,
//     metadatas,
//   });

//   return {
//     storedChunks: chunks.length,
//   };
// };

// // Search relevant PDF text
// const searchDocumentChunks = async (
//   documentId,
//   questionEmbedding,
//   limit = 5,
//   options = {},
// ) => {
//   const collection = await getVectorCollection(options);

//   const results = await collection.query({
//     queryEmbeddings: [questionEmbedding],
//     nResults: limit,
//     where: {
//       documentId: String(documentId),
//     },
//     include: ["documents", "metadatas", "distances"],
//   });

//   return (results.ids?.[0] || []).map((id, index) => ({
//     id,
//     content: results.documents?.[0]?.[index],
//     metadata: results.metadatas?.[0]?.[index],
//     distance: results.distances?.[0]?.[index],
//   }));
// };

// const deleteDocumentChunks = async documentId => {
//   const collection = await getVectorCollection();
//   await collection.delete({ where: { documentId: String(documentId) } });
// };

// module.exports = {
//   deleteDocumentChunks,
//   getVectorCollection,
//   storeDocumentChunks,
//   searchDocumentChunks,
// };

const { createHash } = require("crypto");

const qdrant = require("../../../config/qdrant");

const { createInferenceDocument } = require("./embedding.service");

const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "document_chunks_v2";

const BATCH_SIZE = 16;

/**
 * Require a document ID and authenticated user ID.
 * Prevent cross-user vector access.
 */
const createDocumentFilter = (documentId, userId) => {
  if (!documentId || !userId) {
    throw new Error("documentId and userId are required");
  }

  return {
    must: [
      {
        key: "userId",
        match: {
          value: String(userId),
        },
      },
      {
        key: "documentId",
        match: {
          value: String(documentId),
        },
      },
    ],
  };
};

/**
 * Generate a stable UUID from a document chunk.
 *
 * Qdrant point IDs must be valid UUIDs or unsigned integers.
 */
const createPointId = (chunk) => {
  const source = [
    String(chunk.documentId),
    String(chunk.pageNumber),
    String(chunk.chunkNumber),
  ].join(":");

  const hash = createHash("sha256").update(source).digest();

  const bytes = Buffer.from(hash.subarray(0, 16));

  // Set UUID version and variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

/**
 * Check the configured Qdrant collection.
 */
const getVectorCollection = async ({ signal } = {}) => {
  signal?.throwIfAborted();

  return qdrant.getCollection(COLLECTION_NAME);
};

/**
 * Store document chunks.
 *
 * Qdrant Cloud Inference generates embeddings directly.
 *
 * @param {Array} chunks
 * @param {string} userId - Authenticated user's MongoDB ID
 */
const storeDocumentChunks = async (chunks, userId) => {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error("Chunks must be a non-empty array");
  }

  if (!userId) {
    throw new Error("Authenticated userId is required");
  }

  const documentId = String(chunks[0].documentId);

  if (chunks.some((chunk) => String(chunk.documentId) !== documentId)) {
    throw new Error("All chunks must belong to one document");
  }

  let storedChunks = 0;

  console.log("[Qdrant] Starting document indexing");

  // Remove previous vectors before replacing document chunks.
  // A failed reindex can leave partial results, so the
  // document must only be marked ready after all batches succeed.
  await deleteDocumentChunks(documentId, userId);

  for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
    const batch = chunks.slice(start, start + BATCH_SIZE);

    const points = batch.map((chunk) => {
      const content = String(chunk.content || "").trim();

      if (!content) {
        throw new Error("Document chunk content is empty");
      }

      return {
        id: createPointId(chunk),

        // Qdrant generates vectors using Cloud Inference.
        vector: createInferenceDocument(content),

        payload: {
          userId: String(userId),
          documentId: String(chunk.documentId),
          pageNumber: Number(chunk.pageNumber),
          chunkNumber: Number(chunk.chunkNumber),
          content,
        },
      };
    });

    const result = await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points,
    });

    if (result.status !== "completed") {
      throw new Error(`Qdrant insertion did not complete: ${result.status}`);
    }

    storedChunks += batch.length;

    console.log(`[Qdrant] Indexed ${storedChunks}/${chunks.length} chunks`);
  }

  console.log("[Qdrant] Document indexing completed");

  return {
    storedChunks,
  };
};

/**
 * Search relevant chunks using plain question text.
 *
 * IMPORTANT: userId must come from authenticated server-side
 * context, never directly from a browser-supplied userId.
 */
const searchDocumentChunks = async (
  documentId,
  question,
  limit = 5,
  options = {},
) => {
  const { userId, signal } = options;

  if (!userId) {
    throw new Error("Authenticated userId is required");
  }

  if (typeof question !== "string" || !question.trim()) {
    throw new Error("Question must be a non-empty string");
  }

  signal?.throwIfAborted();

  const validLimit = Math.min(Math.max(Number(limit) || 5, 1), 20);

  const results = await qdrant.query(COLLECTION_NAME, {
    query: createInferenceDocument(question),

    filter: createDocumentFilter(documentId, userId),

    limit: validLimit,

    with_payload: true,
    with_vector: false,
  });

  signal?.throwIfAborted();

  const matches = results.points || [];

  return matches.map((point) => ({
    id: String(point.id),

    content: point.payload?.content || "",

    metadata: {
      documentId: point.payload?.documentId,
      pageNumber: point.payload?.pageNumber,
      chunkNumber: point.payload?.chunkNumber,
    },

    score: point.score,

    // Preserve the lower-is-better distance shape
    // expected by some existing RAG callers.
    distance: 1 - point.score,
  }));
};

/**
 * Delete all vectors for one user's document.
 */
const deleteDocumentChunks = async (documentId, userId) => {
  if (!documentId || !userId) {
    throw new Error("documentId and userId are required");
  }

  await qdrant.delete(COLLECTION_NAME, {
    wait: true,

    filter: createDocumentFilter(documentId, userId),
  });

  return {
    success: true,
    documentId: String(documentId),
  };
};

module.exports = {
  getVectorCollection,
  storeDocumentChunks,
  searchDocumentChunks,
  deleteDocumentChunks,
};
