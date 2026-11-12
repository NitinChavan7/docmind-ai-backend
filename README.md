# DocMind AI - Backend

DocMind AI lets users upload PDFs, ask questions about their contents and return to saved conversations. This repository contains the Express backend: authentication, private file storage, document indexing and streamed answers with PDF sources.

Built by **Nitin Chavan** · [View my portfolio](https://nitin-chavan-portfolio.vercel.app/)

## How it works

```text
PDF upload -> Supabase Storage -> page text -> overlapping chunks
           -> Qdrant Cloud Inference -> Qdrant collection

Question + saved history -> optional question rewrite -> filtered Qdrant search
                        -> PDF context + original question -> Groq
                        -> SSE answer -> completed turn saved in MongoDB
```

| Service | Role |
| --- | --- |
| Express 5 / Node.js | API routes, authentication and streaming |
| MongoDB / Mongoose | Users, refresh sessions, PDF metadata, chats and messages |
| Supabase Storage | Private PDF objects |
| Qdrant Cloud Inference | Embeddings using `sentence-transformers/all-minilm-l6-v2` by default |
| Qdrant | Chunk text, page metadata and semantic search |
| Groq | Question rewriting and answers using `openai/gpt-oss-20b` by default |

The active services do not call Ollama or Chroma. Some older scripts, packages and test fixtures remain from that implementation.

## Setup

Use Node.js 22.12+ and npm. You need MongoDB, a private Supabase bucket, a Qdrant collection compatible with the embedding model, and a Groq API key.

```powershell
npm install
Copy-Item .env.example .env
```

The checked-in `.env.example` includes the cloud settings and free-plan defaults. Fill in your local service configuration:

```dotenv
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
MONGO_URI=mongodb://127.0.0.1:27017/docmind_ai
JWT_ACCESS_SECRET=<independent-secret-at-least-32-characters>
JWT_REFRESH_SECRET=<different-secret-at-least-32-characters>
SUPABASE_URL=<supabase-project-url>
SUPABASE_SECRET_KEY=<server-side-secret-key>
SUPABASE_BUCKET=<private-pdf-bucket>
QDRANT_URL=<qdrant-cluster-url>
QDRANT_API_KEY=<qdrant-api-key>
QDRANT_COLLECTION=document_chunks_v2
QDRANT_EMBEDDING_MODEL=sentence-transformers/all-minilm-l6-v2
GROQ_API_KEY=<groq-api-key>
GROQ_MODEL=openai/gpt-oss-20b
GOOGLE_CLIENT_ID=
```

Generate each JWT secret separately:

```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
npm run dev
```

`npm start` runs without the development watcher. `GET /api/health` checks that the HTTP app is running; it does not verify all cloud services.

The active vector service defaults to `document_chunks_v2`. The current MiniLM integration expects 384-dimensional vectors and uses owner/document payload filters. Configure a compatible collection and payload indexes for `userId` and `documentId` where required by your cluster. The older `setup-qdrant.js` defaults to a different collection and creates 768-dimensional vectors; it is not suitable for the current MiniLM setup as written.

Keep service keys on the backend. The frontend needs only its API URL and, optionally, the public Google client ID. See [configuration](config/README.md) for the complete variable reference.

## API

All document, chat and RAG routes require an active session. Mutations also require an allowed origin and a session-bound `X-CSRF-Token` obtained from `GET /api/auth/csrf`. Preserve cookies across requests and fetch a new CSRF token after authentication changes.

| Area | Routes |
| --- | --- |
| Authentication | `GET /api/auth/config`, `/api/auth/csrf`, `/api/auth/me`; `POST /api/auth/register`, `/api/auth/login`, `/api/auth/google`, `/api/auth/refresh`, `/api/auth/logout` |
| Documents | `POST /api/documents/upload`; `GET /api/documents`, `/api/documents/:id`, `/api/documents/:id/view`, `/api/documents/:id/file`; `POST /api/documents/:id/process`; `DELETE /api/documents/:id` |
| Chats | `POST /api/chats`; `GET /api/chats?documentId=...` |
| Messages | `GET /api/chats/:id/messages`; `POST /api/chats/:id/messages`; `POST /api/chats/:id/stream` |

Upload multipart field `file` with a PDF up to 10 MiB, process the returned document ID, then create a chat for the ready document. Questions are limited to 4,000 characters and saved answers to 20,000. Message history accepts `limit=1..100` and `before=<message-id>`.

JSON sends accept `{question,requestId?}`. Reuse the same request ID when retrying the same question. Streaming accepts `{question}` and sends `status`, `meta`, `token` and terminal events over SSE. A complete turn is saved before `done`. Reload history after an interrupted stream before sending the question again. See the [streaming contract](docs/STREAMING.md).

The legacy `POST /api/rag/ask` route remains available and shares the account question quota. Prefer chat endpoints for saved conversation history.

## Authentication and data

Password login uses bcrypt. Google login verifies an ID token against `GOOGLE_CLIENT_ID`; `/api/auth/config` exposes that public ID to the frontend. Accounts with matching emails are not silently linked.

Access cookies last 15 minutes and refresh cookies seven days. Refresh tokens rotate, their hashes are stored in MongoDB, and reuse of an old token revokes the session. Logout revokes access through the session record. Cookies are HttpOnly, SameSite=Lax and Secure in production; use HTTPS and compatible same-site frontend/API routing. `CLIENT_URL` accepts comma-separated origins. The app trusts one proxy hop in production; check that against your hosting setup.

MongoDB ownership checks protect documents and chats. Qdrant search/deletion filters include both authenticated `userId` and `documentId`. Supabase object keys use the owner's ID and a generated filename. Local upload and processing files are temporary. Deletion coordinates vectors, stored PDFs, messages, chats and metadata; it can require a retry if one store fails.

## Documentation

- [Free-plan limits, migration and cleanup](docs/FREE_PLAN.md)
- [Documentation index](docs/README.md)
- [Module overview](modules/README.md)
- [Database models](modules/database/models/README.md)
- [AI models](docs/ai-models/README.md)
- [Prompt engineering](docs/PROMPT_ENGINEERING.md)
- [Libraries](docs/LIBRARIES.md)
- [Automated tests](tests/README.md)
- [Manual diagnostics](scripts/README.md)

## Free plan

Defaults: five PDFs, 10 MiB per PDF, 30 MiB total storage, 25 pages per PDF, ten conversations, 50 accepted questions per chat, 30 questions per UTC day, five generation admissions per minute and one active generation per account. PDFs and chats expire after 30 days. Backend quotas use MongoDB and also cover SSE and legacy RAG.

`GET /api/usage` returns account usage and the next UTC reset. `DELETE /api/chats/:chatId` frees a conversation slot. Physical retention cleanup requires an external scheduler; none is enabled by this change. Review [the rollout guide](docs/FREE_PLAN.md) before backfilling legacy expiry or running cleanup with `--apply`.

## Response time

Standalone questions skip an extra Groq rewrite call, including when saved history exists. Contextual follow-ups still use rewriting, with an eight-second fallback deadline. GPT-OSS defaults to low reasoning effort; set `GROQ_REASONING_EFFORT=medium` or `high` for complex analysis. Authentication queries run in parallel, and committed chat history has an index matching its pagination. Restart the backend to load these changes and initialize the index.

Run `npm run test:latency` for the isolated latency and persistence checks. These verify call counts, cancellation and correctness with mocked cloud responses; they do not measure hosted-service latency.

## Tests and known limitations

```powershell
npm test
```

The suite covers accounts, ownership, persistence, streaming, quota races, retention and cleanup using temporary MongoDB and mocked cloud services. Live service diagnostics require configured credentials and are separate from automated tests.

PDF extraction has no OCR. Character-based chunk limits do not enforce a token budget. Retrieved sources and prompt instructions help ground answers but do not guarantee accuracy. Account quotas, rolling-minute admissions and generation leases are stored in MongoDB. Existing process-local capacity and IP limits also apply. Email verification for local accounts, password recovery and account linking are not implemented.
