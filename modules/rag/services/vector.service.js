const { ChromaClient } = require("chromadb");

const chromaUrl = new URL(process.env.CHROMA_URL || 'http://127.0.0.1:8000');
const clientOptions = {
  host: chromaUrl.hostname,
  port: Number(chromaUrl.port || (chromaUrl.protocol === 'https:' ? 443 : 80)),
  ssl: chromaUrl.protocol === 'https:',
};
const client = new ChromaClient(clientOptions);

const COLLECTION_NAME = process.env.CHROMA_COLLECTION || "document_chunks";

const getVectorCollection = async ({ signal } = {}) => {
  signal?.throwIfAborted();
  const requestClient = signal ? new ChromaClient({ ...clientOptions, fetchOptions: { signal } }) : client;
  return await requestClient.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: null,
  });
};

// Save PDF chunks and embeddings
const storeDocumentChunks = async (chunks, embeddings) => {
  if (
    !Array.isArray(chunks) ||
    chunks.length === 0 ||
    !Array.isArray(embeddings) ||
    chunks.length !== embeddings.length
  ) {
    throw new Error("Invalid chunks or embeddings");
  }

  const collection = await getVectorCollection();

  const ids = chunks.map(
    (chunk) =>
      `${chunk.documentId}_page${chunk.pageNumber}_chunk${chunk.chunkNumber}`,
  );

  const documents = chunks.map((chunk) => chunk.content);

  const metadatas = chunks.map((chunk) => ({
    documentId: String(chunk.documentId),
    pageNumber: chunk.pageNumber,
    chunkNumber: chunk.chunkNumber,
  }));

  await collection.upsert({
    ids,
    documents,
    embeddings,
    metadatas,
  });

  return {
    storedChunks: chunks.length,
  };
};

// Search relevant PDF text
const searchDocumentChunks = async (
  documentId,
  questionEmbedding,
  limit = 5,
  options = {},
) => {
  const collection = await getVectorCollection(options);

  const results = await collection.query({
    queryEmbeddings: [questionEmbedding],
    nResults: limit,
    where: {
      documentId: String(documentId),
    },
    include: ["documents", "metadatas", "distances"],
  });

  return (results.ids?.[0] || []).map((id, index) => ({
    id,
    content: results.documents?.[0]?.[index],
    metadata: results.metadatas?.[0]?.[index],
    distance: results.distances?.[0]?.[index],
  }));
};

const deleteDocumentChunks = async documentId => {
  const collection = await getVectorCollection();
  await collection.delete({ where: { documentId: String(documentId) } });
};

module.exports = {
  deleteDocumentChunks,
  getVectorCollection,
  storeDocumentChunks,
  searchDocumentChunks,
};
