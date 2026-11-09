const { generateEmbeddings } = require("./embedding.service");

const llm = require("./llm.service");

const { retrieveDocumentContext } = require("../repository");

const prepareDocumentAnswer = async (documentId, question, history = [], options = {}) => {
  options.signal?.throwIfAborted();
  await options.onStatus?.("understanding");
  // Step 1: Understand spelling mistakes and follow-up questions
  const searchQuestion = await llm.rewriteQuestion(question, history, options);


  // Step 2: Generate embedding for the rewritten question
  await options.onStatus?.("retrieving");
  const [questionEmbedding] = await generateEmbeddings([searchQuestion], options);


  // Step 3: Retrieve relevant PDF chunks
  const chunks = await retrieveDocumentContext(
    documentId,
    questionEmbedding,
    5,
    options,
  );
  options.signal?.throwIfAborted();


  // Step 4: Handle empty results
  if (!chunks.length) {
    return {
      fallback: "I couldn't find relevant information in this document.",
      context: "",
      sources: [],
    };
  }

  // Step 5: Arrange chunks in original PDF order
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

  // Step 6: Prepare document context
  const context = orderedChunks
    .map((chunk, index) => {
      return `
[Source ${index + 1} | Page ${chunk.metadata?.pageNumber}]
${chunk.content}
      `.trim();
    })
    .join("\n\n---\n\n");



  return {
    context,
    sources: orderedChunks.map((chunk) => ({
      documentId,
      pageNumber: chunk.metadata?.pageNumber,
      chunkNumber: chunk.metadata?.chunkNumber,
      content: chunk.content,
      distance: chunk.distance,
    })),
  };
};

const askDocument = async (documentId, question, history = []) => {
  const prepared = await prepareDocumentAnswer(documentId, question, history);
  return { answer: prepared.fallback || await llm.generateAnswer(question, prepared.context, history), sources: prepared.sources };
};

const streamDocument = async (documentId, question, history, options) => {
  const prepared = await prepareDocumentAnswer(documentId, question, history, options);
  await options.onSources(prepared.sources);
  if (prepared.fallback) {
    await options.onToken(prepared.fallback);
    return { answer: prepared.fallback, sources: prepared.sources };
  }
  await options.onStatus('generating');
  let answer = '';
  for await (const text of llm.streamAnswer(question, prepared.context, history, options)) {
    answer += text;
    await options.onToken(text);
  }
  if (!answer.trim()) throw new Error('Ollama returned an empty answer');
  return { answer: answer.trim(), sources: prepared.sources };
};
module.exports = { askDocument, prepareDocumentAnswer, streamDocument };
