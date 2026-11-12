const llm = require("./llm.service");

const { searchDocumentChunks } = require("./vector.service");

// ---------------------------------------------
// Validate authenticated document search
// ---------------------------------------------
const validateRequest = (documentId, question, options = {}) => {
  if (!options.userId) {
    throw new Error("Authenticated userId is required");
  }

  if (!documentId) {
    throw new Error("Document ID is required");
  }

  if (typeof question !== "string" || !question.trim()) {
    throw new Error("Question must be a non-empty string");
  }

  options.signal?.throwIfAborted();
};

// ---------------------------------------------
// Retrieve relevant PDF document context
// ---------------------------------------------
const prepareDocumentAnswer = async (
  documentId,
  question,
  history = [],
  options = {},
) => {
  validateRequest(documentId, question, options);

  const { userId, signal } = options;

  // STEP 1: Understand the question.
  await options.onStatus?.("understanding");

  const searchQuestion = await llm.rewriteQuestion(question, history, options);

  signal?.throwIfAborted();

  console.log("[RAG] Question prepared");

  // STEP 2: Retrieve chunks from Qdrant Cloud.
  await options.onStatus?.("retrieving");

  const chunks = await searchDocumentChunks(documentId, searchQuestion, 5, {
    userId,
    signal,
  });

  signal?.throwIfAborted();

  console.log("[RAG] Relevant chunks found:", chunks.length);

  // STEP 3: Handle no matching results.
  if (!chunks.length) {
    return {
      fallback:
        "I couldn't find this information in the uploaded PDF. I can answer questions only about the content of this document.",
      context: "",
      sources: [],
    };
  }

  // STEP 4: Sort retrieved chunks by page and
  // their original position within the page.
  const orderedChunks = [...chunks].sort((a, b) => {
    const pageA = Number(a.metadata?.pageNumber ?? 0);

    const pageB = Number(b.metadata?.pageNumber ?? 0);

    if (pageA !== pageB) {
      return pageA - pageB;
    }

    const chunkA = Number(a.metadata?.chunkNumber ?? 0);

    const chunkB = Number(b.metadata?.chunkNumber ?? 0);

    return chunkA - chunkB;
  });

  // STEP 5: Build grounded context.
  const context = orderedChunks
    .map((chunk, index) => {
      const pageNumber = chunk.metadata?.pageNumber ?? "Unknown";

      return `
[Source ${index + 1} | Page ${pageNumber}]
${String(chunk.content || "").trim()}
      `.trim();
    })
    .join("\n\n---\n\n");

  // STEP 6: Build source references.
  const sources = orderedChunks.map((chunk) => ({
    documentId: String(documentId),

    pageNumber: chunk.metadata?.pageNumber,

    chunkNumber: chunk.metadata?.chunkNumber,

    content: String(chunk.content || ""),

    distance: chunk.distance,
  }));

  return {
    context,
    sources,
  };
};

// ---------------------------------------------
// Non-streaming document questions
// ---------------------------------------------
const askDocument = async (
  documentId,
  question,
  history = [],
  options = {},
) => {
  const prepared = await prepareDocumentAnswer(
    documentId,
    question,
    history,
    options,
  );

  if (prepared.fallback) {
    await options.onGenerationStart?.();
    return {
      answer: prepared.fallback,
      sources: prepared.sources,
    };
  }

  const answer = await llm.generateAnswer(
    question,
    prepared.context,
    history,
    options,
  );

  return {
    answer,
    sources: prepared.sources,
  };
};

// ---------------------------------------------
// Stream document answers
// ---------------------------------------------
const streamDocument = async (
  documentId,
  question,
  history = [],
  options = {},
) => {
  const prepared = await prepareDocumentAnswer(
    documentId,
    question,
    history,
    options,
  );

  // Send PDF references to frontend.
  await options.onSources?.(prepared.sources);

  // If no relevant chunks were found,
  // return a completed fallback answer.
  if (prepared.fallback) {
    await options.onGenerationStart?.();
    await options.onToken?.(prepared.fallback);

    return {
      answer: prepared.fallback,
      sources: prepared.sources,
    };
  }

  // Start AI answer generation.
  await options.onStatus?.("generating");

  console.log("[RAG] Starting Groq answer generation");

  let answer = "";

  // Stream every answer fragment to the frontend.
  for await (const token of llm.streamAnswer(
    question,
    prepared.context,
    history,
    options,
  )) {
    options.signal?.throwIfAborted();

    answer += token;

    await options.onToken?.(token);
  }

  if (!answer.trim()) {
    throw new Error("Groq returned an empty answer");
  }

  console.log("[RAG] Answer generation completed");

  return {
    answer: answer.trim(),
    sources: prepared.sources,
  };
};

module.exports = {
  askDocument,
  prepareDocumentAnswer,
  streamDocument,
};
