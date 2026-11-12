# Backend modules

Backend features live here, grouped by responsibility. Each feature exposes an Express router and uses CommonJS (`require`, `module.exports`). Document, chat and RAG modules have repositories; authentication accesses its models directly.

| Folder | Main responsibility | Documentation |
| --- | --- | --- |
| `auth/` | Identify users and manage revocable sessions | [Auth README](auth/README.md) |
| `document/` | Manage private PDFs and prepare searchable chunks | [Document README](document/README.md) |
| `chat/` | Save conversations and answer questions | [Chat README](chat/README.md) |
| `rag/` | Retrieve PDF evidence and call AI models | [RAG README](rag/README.md) |
| `database/` | Define and export MongoDB models | [Database README](database/README.md) |
| `usage/` | Account quotas, expiry and cleanup | [Usage README](usage/README.md) |

## Router entry point

[index.js](index.js) mounts `/auth` first. It then applies `requireAuth` and `verifyCsrf` before mounting `/documents`, `/rag`, `/chats` and `/usage`. [app.js](../app.js) mounts this router under `/api`.

For example, a route written as `/:chatId/stream` inside `chat/index.js` becomes `/api/chats/:chatId/stream`.

## Layers and libraries

| Layer | What it does | Typical dependencies |
| --- | --- | --- |
| Router (`index.js`) | Maps HTTP method/path to a handler; attaches limiters | `express`, `express-rate-limit` |
| Controller (`controller/index.js`) | Validates input, checks ownership, coordinates services and returns HTTP responses | `mongoose`, repositories, services |
| Repository (`repository/index.js`) | Runs MongoDB queries or delegates vector retrieval | Mongoose models, vector service |
| Service (`services/*.js`) | Implements PDF, AI, token or concurrency work | Node APIs and feature-specific packages |
| Database model | Defines fields, validation and indexes | `mongoose` |

## Startup

[server.js](../server.js) loads `.env` with `dotenv`, validates JWT configuration, calls [config/db.js](../config/db.js), waits for model initialization/indexes, and listens on `PORT` (default 5000). `app.js` builds Express without starting a listener, so tests can import it.

Do not call a low-level RAG/vector function directly from a new public route without ownership checks. Those services accept internal IDs and are not an authentication boundary.
