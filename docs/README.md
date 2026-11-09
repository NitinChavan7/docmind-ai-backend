# DocMind backend documentation

Start here when learning or maintaining this existing backend. These guides describe the implementation in this repository, including its current limitations; they do not assume features that have not been built.

## What does "model" mean here?

| Term | Meaning | Guides |
| --- | --- | --- |
| Module | A feature folder containing routes, controllers, repositories and services | [Module overview](../modules/README.md) |
| Database model | A Mongoose schema representing records stored in MongoDB | [Five database models](../modules/database/models/README.md) |
| AI model | A model served by Ollama for generating text or embedding it | [Ollama model overview](ai-models/README.md) |

## Feature guides

- [Authentication](../modules/auth/README.md): registration, password/Google login, JWTs, cookies and refresh sessions.
- [Documents](../modules/document/README.md): uploading, viewing, parsing, chunking, indexing and deleting PDFs.
- [Chats](../modules/chat/README.md): candidate conversations, saved messages, JSON answers and streaming answers.
- [RAG](../modules/rag/README.md): question rewriting, embeddings, vector search and grounded answer generation.
- [Database](../modules/database/README.md): model exports, collections, ownership and connection setup.
- [Streaming API](STREAMING.md): exact SSE contract, cancellation/persistence policy and Windows commands.

## Supporting code

- [Middleware](../middleware/README.md): authentication, CSRF, origin checks, uploads and document operations.
- [Configuration](../config/README.md): environment settings, cookie lifetimes and generation limits.
- [Stream utilities](../utils/README.md): UTF-8/NDJSON/SSE parsing and SSE output.
- [Manual scripts](../scripts/README.md): CLI streaming and the root connectivity checks.
- [Tests](../tests/README.md): test files, dependencies and what is simulated.
- [Libraries](LIBRARIES.md): every direct package in `package.json` and its purpose.

## How one question moves through the backend

1. [app.js](../app.js) parses cookies/JSON and checks the request origin.
2. [modules/index.js](../modules/index.js) requires an active user session and validates CSRF for protected mutations.
3. The chat controller checks both chat and PDF ownership and loads saved history from MongoDB.
4. The RAG service rewrites the question, embeds it, searches the selected PDF's chunks, and builds context.
5. Ollama generates a full answer or streaming deltas from that context and history.
6. The chat repository journals and saves the completed user/assistant turn. The response includes PDF source references.

## Where data lives

MongoDB stores users, sessions, document metadata, chats and messages. The private `uploads/` directory stores PDF bytes. Chroma stores PDF chunk text, metadata and numeric vectors. Ollama performs model inference; it is not the application's account or conversation database.

Actual secrets belong in `.env` or your deployment's secret storage. Guides use variable names and placeholders, never real passwords, JWTs or OAuth secrets.
