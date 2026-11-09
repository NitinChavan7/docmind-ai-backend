# Chat model: llama3.2:3b

This is the backend's default text-generation model. It is hosted by Ollama; it is not installed as an npm dependency. The code selects `process.env.OLLAMA_CHAT_MODEL || 'llama3.2:3b'`.

## Why the application uses it

The same configured chat model has two jobs: rewrite an unclear question for retrieval, then answer the original question using retrieved PDF evidence and saved conversation memory. Rewriting is not answering; its prompt asks the model to preserve intent and return only the clarified question.

## Functions and libraries

Source: [llm.service.js](../../../modules/rag/services/llm.service.js). Called from [rag.service.js](../../../modules/rag/services/rag.service.js).

| Function | Use of the model |
| --- | --- |
| `rewriteQuestion(question,history,options)` | Non-streaming clarification; caps rewritten output at 1,000 characters; ordinary failure falls back to the question |
| `buildAnswerMessages(question,context,history)` | Builds the shared grounding/safety prompt; does not itself call Ollama |
| `generateAnswer(question,context,history,options)` | Returns one full trimmed answer |
| `streamAnswer(question,context,history,{signal})` | Async generator yielding assistant content deltas |
| `callOllama(messages,{signal})` (internal) | Shared non-streaming HTTP helper |

Node APIs used: `fetch`, `AbortController`, `AbortSignal`. Stream decoding uses the project's [NDJSON utility](../../../utils/stream.js). The `chromadb` package retrieves evidence before the answer call, but does not generate this text.

## Request, response and settings

Ollama endpoint: `POST <OLLAMA_BASE_URL>/api/chat`. The body includes `model`, `messages`, `stream` and `options:{temperature:0.2}`. Non-streaming reads `message.content`; streaming parses newline-delimited JSON and forwards only `message.content` deltas until `done:true`.

Both answer paths use the same system/context/history messages. Temperature is a runtime generation setting; it is not an accuracy guarantee. Calls have a 120-second upstream deadline, while streaming additionally honors the overall generation deadline and client cancellation. Streaming output is capped at 20,000 characters and must be nonempty and complete before normal persistence.

## Running and changing it

```powershell
ollama pull llama3.2:3b
ollama list
# In backend .env:
# OLLAMA_BASE_URL=http://127.0.0.1:11434
# OLLAMA_CHAT_MODEL=llama3.2:3b
npm run dev
```

Changing `OLLAMA_CHAT_MODEL` changes both rewriting and answering after restarting the backend. It does not change stored embedding vectors; existing PDF indexing is independent of the chat-model setting. The project has not validated every other model's prompt behavior or streaming features.

## Limits

The prompt tells the model to use document facts and treat PDF text as untrusted data. This reduces unwanted instruction-following but cannot prove every answer is correct. Sources are retrieved chunk references, not a verified explanation that every generated sentence follows from a cited chunk. Users should inspect important facts in the original PDF.
