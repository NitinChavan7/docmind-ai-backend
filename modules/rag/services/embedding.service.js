// const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

// const generateEmbeddings = async (texts, { signal } = {}) => {
//   if (!Array.isArray(texts) || texts.length === 0) {
//     throw new Error("Texts must be a non-empty array");
//   }

//   const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
//     signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//     },
//     body: JSON.stringify({
//       model: "nomic-embed-text",
//       input: texts,
//     }),
//   });

//   if (!response.ok) {
//     throw new Error(`Ollama embedding error: ${response.status}`);
//   }

//   const result = await response.json();

//   if (
//     !Array.isArray(result.embeddings) ||
//     result.embeddings.length !== texts.length
//   ) {
//     throw new Error("Invalid embedding response");
//   }

//   return result.embeddings;
// };

// module.exports = {
//   generateEmbeddings,
// };

const EMBEDDING_MODEL =
  process.env.QDRANT_EMBEDDING_MODEL ||
  "sentence-transformers/all-minilm-l6-v2";

const MAX_EMBEDDING_CHARACTERS = 600;

/**
 * Prepare text for Qdrant Cloud Inference.
 *
 * Qdrant generates the numerical embeddings in the cloud,
 * so we no longer call Ollama.
 *
 * MiniLM supports up to 256 input tokens.
 * The character limit is a conservative approximation,
 * not a guaranteed token limit.
 */
const createInferenceDocument = (text) => {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Embedding text must be a non-empty string");
  }

  const cleanText = text.trim();

  if (cleanText.length > MAX_EMBEDDING_CHARACTERS) {
    throw new Error(
      "Embedding text is too long. Split the document into smaller chunks.",
    );
  }

  return {
    text: cleanText,
    model: EMBEDDING_MODEL,
  };
};

/**
 * Validate multiple document texts.
 *
 * No numerical embeddings are returned.
 * Qdrant performs embedding generation when inserting points.
 */
const prepareEmbeddingDocuments = (texts) => {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error("Texts must be a non-empty array");
  }

  return texts.map(createInferenceDocument);
};

module.exports = {
  EMBEDDING_MODEL,
  MAX_EMBEDDING_CHARACTERS,
  createInferenceDocument,
  prepareEmbeddingDocuments,
};
