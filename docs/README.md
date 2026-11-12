# Backend documentation

DocMind uses Express for its API, MongoDB for application records, Supabase for PDFs, Qdrant for document search and Groq for answers.

## Feature guides

| Guide | Covers |
| --- | --- |
| [Modules](../modules/README.md) | Routing, layers and startup |
| [Authentication](../modules/auth/README.md) | Password/Google login, cookies, refresh and logout |
| [Documents](../modules/document/README.md) | Upload, storage, extraction, indexing and deletion |
| [Chats](../modules/chat/README.md) | Conversations, history and completed-turn persistence |
| [RAG](../modules/rag/README.md) | Rewriting, retrieval, context and model calls |
| [Database](../modules/database/README.md) | Connections and relationships |
| [Database models](../modules/database/models/README.md) | Fields and indexes for the seven Mongoose models |
| [AI models](ai-models/README.md) | Groq generation and Qdrant inference |
| [Prompt engineering](PROMPT_ENGINEERING.md) | Actual templates and how history/context are used |
| [Streaming](STREAMING.md) | SSE events, cancellation and manual API checks |
| [Free plan](FREE_PLAN.md) | Quotas, schema changes, migration, retention cleanup and scheduler setup |

## Supporting code

- [Configuration](../config/README.md)
- [Middleware](../middleware/README.md)
- [Stream utilities](../utils/README.md)
- [Manual diagnostics](../scripts/README.md)
- [Automated tests](../tests/README.md)
- [Libraries](LIBRARIES.md)

## Following one question

The chat controller verifies the account, chat and document, then loads committed messages from MongoDB. RAG optionally rewrites the question, searches Qdrant with user/document filters, and assembles page-labelled context. Groq generates the answer. The chat repository journals the completed result, saves both messages and updates conversation activity before completion is reported.

MongoDB stores `User`, `AuthSession`, `Document`, `Chat` and `Message` records. Supabase holds private PDF objects. Qdrant holds chunk text, metadata and vectors. Local upload/processing files are temporary.

The old local-model guides remain labelled as historical references. Use current cloud setup instructions in the [main README](../README.md).
