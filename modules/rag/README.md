# Retrieval-augmented generation (RAG)

RAG means finding relevant document text before asking an AI model to answer. This module converts a question into a search vector, retrieves evidence from the selected PDF, builds a prompt and calls Ollama. It does not own authentication or save conversations; callers in the chat/document modules handle those responsibilities.

## Services and libraries

| File | Responsibility | Libraries/APIs |
| --- | --- | --- |
| [services/rag.service.js](services/rag.service.js) | Orchestrates rewriting, retrieval, context and answers | Internal services/repository; plain JavaScript |
| [services/llm.service.js](services/llm.service.js) | Calls Ollama for rewriting and answer generation | Node 20 `fetch`, `AbortController`, `AbortSignal`; NDJSON parser |
| [services/embedding.service.js](services/embedding.service.js) | Calls Ollama to produce numeric vectors | Node `fetch`, `AbortSignal` |
| [services/vector.service.js](services/vector.service.js) | Stores/queries/deletes Chroma chunks | `chromadb` (`ChromaClient`), Node `URL` |
| [repository/index.js](repository/index.js) | Checks ready documents and delegates vector retrieval | Mongoose `Document`, vector service |
| [controller/index.js](controller/index.js), [index.js](index.js) | Legacy one-shot RAG HTTP route | `express`, `mongoose`, generation slot service |

No Ollama JavaScript SDK is installed or needed here; calls use HTTP directly. Chroma receives supplied embeddings with `embeddingFunction:null`. The installed `@chroma-core/default-embed` package is not used to generate embeddings by these services.

## Orchestration functions: `rag.service.js`

| Function | Inputs | Result / work |
| --- | --- | --- |
| `prepareDocumentAnswer(documentId,question,history=[],options={})` | Authorized document ID, question, server-loaded messages; optional signal/status callback | Rewrites question, embeds it, retrieves up to five chunks, sorts by page/chunk and returns `{context,sources}` or `{fallback,context:'',sources:[]}` |
| `askDocument(documentId,question,history=[])` | Same trusted ID/question/history | Uses shared preparation, generates a complete answer or returns fallback; resolves `{answer,sources}` |
| `streamDocument(documentId,question,history,options)` | Same plus `signal`, `onStatus`, `onSources`, `onToken` callbacks | Prepares context, reports sources, forwards deltas, accumulates final text and resolves `{answer,sources}` |

The rewritten question is used for retrieval; answer generation receives the original question and saved history. Source records preserve `documentId`, `pageNumber`, `chunkNumber`, `content` and `distance`. Multiple chunks can refer to the same PDF/page; they are evidence chunks, not multiple uploaded documents.

Empty retrieval returns the existing "I couldn't find relevant information in this document" fallback instead of asking the model to guess. Streaming status callbacks run for actual work: `understanding`, `retrieving`, and `generating` only when model answer generation runs.

## Language-model functions: `llm.service.js`

| Function | Purpose and return value |
| --- | --- |
| `callOllama(messages,{signal}={})` (internal) | POSTs `/api/chat` with `stream:false`, selected model and temperature 0.2; returns trimmed nonempty content |
| `rewriteQuestion(question,history=[],options={})` | Uses history to clarify spelling/follow-ups; returns a rewritten question capped at 1,000 characters, or the original question on ordinary rewrite failure |
| `buildAnswerMessages(question,context,history=[])` | Returns system + history + context/question messages; shared by JSON and streaming answers |
| `generateAnswer(question,context,history=[],options={})` | Calls the non-streaming helper with the shared prompt; resolves answer text |
| `streamAnswer(question,context,history=[],{signal}={})` | Async generator yielding only valid assistant content deltas from Ollama NDJSON |

The system prompt asks for grounded facts, treats PDF content as untrusted data and uses conversation memory to understand follow-ups. This is prompt guidance, not proof that a model can never hallucinate; users should check important details against the cited PDF.

Ollama calls have a 120-second upstream timeout. Streaming combines that with caller cancellation, handles split UTF-8/JSON, requires `done:true`, limits the answer to 20,000 characters and rejects upstream errors, empty answers, truncated streams or length-stopped output. The reader/fetch is cleaned up on success, failure or cancellation. Rewrite fallback does not swallow a caller's cancellation.

## Embedding and vector functions

`generateEmbeddings(texts,{signal}={})` requires a nonempty text array, POSTs `{model:'nomic-embed-text',input:texts}` to `/api/embed`, checks successful HTTP status and that the number of returned embeddings matches the inputs, then returns a vector array. It does not currently validate every vector's dimension or numeric entries; keep the embedding model consistent with the collection. See the [embedding model guide](../../docs/ai-models/nomic-embed-text/README.md).

| Vector function | What it does |
| --- | --- |
| `getVectorCollection({signal}={})` | Gets/creates `CHROMA_COLLECTION` with supplied embeddings; uses a signal-bound client for cancellable reads |
| `storeDocumentChunks(chunks,embeddings)` | Validates matching nonempty arrays and upserts chunk text, vectors and page/document metadata; returns `{storedChunks}` |
| `searchDocumentChunks(documentId,questionEmbedding,limit=5,options={})` | Queries vectors restricted to the document ID; returns `{id,content,metadata,distance}` results |
| `deleteDocumentChunks(documentId)` | Removes vectors whose metadata matches that document |

Chunk IDs use `${documentId}_page${pageNumber}_chunk${chunkNumber}`. Searches use supplied query embeddings, not auto-generated Chroma embeddings. The RAG repository's `retrieveDocumentContext(documentId,embedding,limit=3,options={})` delegates to vector search; the main RAG preparation explicitly asks for five results. `getReadyDocument(documentId,userId)` checks ownership and `status:'ready'` in MongoDB.

## Legacy route, usage and configuration

`RagController.askQuestion(req,res)` handles POST `/api/rag/ask` with `{documentId,question}`. It validates input, verifies a ready owned document, acquires generation capacity and calls `askDocument`. It returns answer/sources but **does not save chat messages** and does not receive saved chat history. Use `/api/chats/:chatId/messages` or `/stream` for persistent conversation memory.

`OLLAMA_BASE_URL` defaults to `http://127.0.0.1:11434`; `OLLAMA_CHAT_MODEL` defaults to `llama3.2:3b`. `nomic-embed-text` is currently hard-coded. `CHROMA_URL` defaults to `http://127.0.0.1:8000`; collection defaults to `document_chunks`. These values are read when the service modules load; restart after changes.

There is no web search or dynamic mode router. These low-level services do not validate ownership themselves: the HTTP controller must check the document/chat before calling them. Read the [AI model guides](../../docs/ai-models/README.md) and [streaming guide](../../docs/STREAMING.md) for usage examples.
