# Document retrieval and answers

This module finds relevant PDF passages in Qdrant and asks Groq to answer from them. Chat controllers supply the authenticated user and saved history, then persist completed turns.

## Services

| File | Responsibility |
| --- | --- |
| [rag.service.js](services/rag.service.js) | Rewrite, retrieve, order context and generate an answer |
| [llm.service.js](services/llm.service.js) | Groq requests, prompt construction and upstream SSE parsing |
| [embedding.service.js](services/embedding.service.js) | Validate text and create Qdrant inference inputs |
| [vector.service.js](services/vector.service.js) | Store, search and delete owner-scoped Qdrant chunks |
| [repository/index.js](repository/index.js) | Ready-document lookup and a retrieval wrapper |
| [controller/index.js](controller/index.js) | Legacy `/api/rag/ask` handler |

## Retrieval flow

`prepareDocumentAnswer(documentId, question, history, options)` requires `options.userId`. It reports `understanding`, rewrites contextual questions when needed, reports `retrieving`, and searches for five chunks. Retrieval uses both `userId` and `documentId` filters. Results are ordered by page and chunk before context is assembled as `[Source N | Page N]` passages.

The rewritten question is used for search. The original question goes to answer generation. Empty retrieval returns "I couldn't find this information in the uploaded PDF. I can answer questions only about the content of this document." without an answer-model call. Search has no minimum score threshold, so returning chunks does not establish that they answer the question.

`askDocument` returns `{answer,sources}`. `streamDocument` sends sources through `onSources`, emits `generating` when applicable, forwards text through `onToken`, and returns the complete answer. Options include `signal` and status/source/token callbacks.

## Groq and prompts

`rewriteQuestion` uses up to six valid history messages, capped at 1,000 characters each. It skips the network call without history or when a conservative local check identifies a standalone question. Short and referential follow-ups still use Groq. The rewrite deadline defaults to eight seconds (`QUESTION_REWRITE_TIMEOUT_MS`), with a 512-token completion budget. Failure, timeout or output longer than 600 characters falls back to the original question; caller cancellation is rethrown.

`buildAnswerMessages` adds the grounding system prompt, up to eight valid history messages capped at 2,000 characters each, and the document context/current question. `generateAnswer` requests a full response; `streamAnswer` yields Groq content deltas. Both use temperature 0.2 and a default 2,048-token completion budget.

Groq requests use `GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-20b`) and a 120-second upstream deadline for answers. GPT-OSS 20B/120B use `GROQ_REASONING_EFFORT` (`low` by default; `medium` and `high` are also accepted). Streaming requires the `[DONE]` marker, a `stop` finish reason and nonempty content; it rejects malformed events, incomplete output and answers over 20,000 characters. Its event buffer is capped at 1 MiB. The parser is implemented inside `llm.service.js`.

The answer prompt restricts facts to the current PDF context and uses history only to resolve references. It instructs the model to reject unrelated requests and use an exact fallback when the passages do not support an answer. Partly supported questions should receive only the supported information, with missing details identified. These are prompt instructions; there is no separate answer-verification step. See [prompt engineering](../../docs/PROMPT_ENGINEERING.md) for the actual templates and examples.

## Embeddings and vectors

`createInferenceDocument(text)` returns `{text,model}` for nonempty text up to 600 characters. `prepareEmbeddingDocuments(texts)` validates an array of those inputs. These functions do not return numeric vectors; Qdrant Cloud Inference creates them. The model defaults to `sentence-transformers/all-minilm-l6-v2` and can be set with `QDRANT_EMBEDDING_MODEL`.

| Function | Behavior |
| --- | --- |
| `getVectorCollection(options)` | Reads the configured collection; does not create it |
| `storeDocumentChunks(chunks,userId)` | Deletes existing document vectors, then upserts batches of 16 with inference text and payload metadata |
| `searchDocumentChunks(documentId,question,limit,options)` | Sends text for inference and filters by authenticated user/document; limit defaults to 5 and is clamped to 1 to 20 |
| `deleteDocumentChunks(documentId,userId)` | Deletes only points matching both IDs |

Point IDs are stable UUIDs derived from document, page and chunk identifiers. Payloads contain `userId`, `documentId`, `pageNumber`, `chunkNumber` and `content`. Search results include `score` and the compatibility value `distance = 1 - score`.

Set `QDRANT_URL`, `QDRANT_API_KEY` and optionally `QDRANT_COLLECTION` (default `document_chunks_v2`). The collection must already match the embedding model. Failed reindexing can leave partial vectors; the document becomes ready only after every batch is confirmed.

Abort signals are checked around Qdrant reads but are not passed to the Qdrant client's query request. Groq fetches do receive cancellation signals.

## Legacy entry points

The registered `/api/rag/ask` controller verifies the owned ready PDF under its operation lease, supplies authenticated `options.userId` and uses the same daily/minute/concurrency quotas as chat. Optional request IDs support cached result replay. It does not save chat history. See [usage limits](../../docs/FREE_PLAN.md).

The repository's `retrieveDocumentContext` still calls its query argument `embedding`; the vector service now expects question text. New callers should follow the current text-query contract and supply authenticated `options.userId`.
