const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

const generateEmbeddings = async (texts, { signal } = {}) => {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error("Texts must be a non-empty array");
  }

  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "nomic-embed-text",
      input: texts,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding error: ${response.status}`);
  }

  const result = await response.json();

  if (
    !Array.isArray(result.embeddings) ||
    result.embeddings.length !== texts.length
  ) {
    throw new Error("Invalid embedding response");
  }

  return result.embeddings;
};

module.exports = {
  generateEmbeddings,
};
