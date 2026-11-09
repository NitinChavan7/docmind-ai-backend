# DocMind AI backend

CommonJS Express API with private PDF storage, MongoDB sessions and candidate-specific conversations.

## Learn the codebase

Start with the [documentation index](docs/README.md). Each backend module now has a README explaining its files, functions, libraries, routes, data flow and current limits. The [database model index](modules/database/models/README.md) links a separate guide for every MongoDB model, and the [Ollama model index](docs/ai-models/README.md) explains the chat and embedding models. See the [library reference](docs/LIBRARIES.md) for all direct backend dependencies and their purposes.

Authenticated streaming answers are available at `POST /api/chats/:chatId/stream`.
The existing JSON message endpoint remains supported. See [Streaming API and Windows testing](docs/STREAMING.md) for the SSE event contract, cancellation/persistence policy, limits and exact PowerShell/curl.exe commands.

Run `npm install`, copy `.env.example` to `.env` for a new installation, set MongoDB and two independent JWT secrets, then run `npm run dev`. Existing `.env` values are preserved; this implementation has generated local JWT secrets where missing. Never commit `.env` or `uploads/`.

The matching frontend is `../docmind-ai-frontend/docmind-ai-frontend`. Run `npm install` and `npm run dev` there. Set `VITE_API_URL=http://localhost:5000` and `VITE_USE_API=true`. The frontend sends cookies, obtains CSRF tokens, refreshes sessions with a shared request promise and a browser lock across tabs, and loads conversations from MongoDB. API mode does not read or write browser chat history. Explicit offline preview (`VITE_USE_API=false`) retains its separate local-storage behavior.

## Authentication

`GET /api/auth/csrf` returns `data.csrfToken` and sets an HttpOnly seed cookie. Send the token as `X-CSRF-Token` on **every mutation**, including login and registration, with the cookie jar preserved. Fetch a fresh CSRF token after changing accounts; tokens are bound to the signed session ID. An expired/missing access token on a protected route returns 401 so clients can refresh before retrying.

| Endpoint | Body / result |
| --- | --- |
| POST /api/auth/register | `{name,email,password}`; returns `data.user` |
| POST /api/auth/login | `{email,password}`; returns `data.user` |
| POST /api/auth/google | `{credential}` containing a Google ID token |
| POST /api/auth/refresh | Rotates the refresh cookie |
| GET /api/auth/me | Returns `data.user` |
| POST /api/auth/logout | Revokes the session and clears cookies |

Access cookies last 15 minutes; refresh cookies last seven days. Sessions store refresh hashes and previously used hashes. Reusing a rotated signed token revokes its session family. Clients must serialize refreshes; the frontend uses Web Locks when available. Clients without Web Locks should avoid concurrent refreshes across tabs because replay detection deliberately fails closed. Logout invalidates access immediately. JWT secrets must contain at least 32 characters and differ. Production cookies require HTTPS and use SameSite=Lax; deploy frontend and API on the same site. `CLIENT_URL` supports comma-separated allowed origins. Configure a specific trusted proxy in `app.js` when deploying behind one.

For Google sign-in, create a Google Web OAuth client, allow your frontend JavaScript origin, and set backend `GOOGLE_CLIENT_ID`. `GET /api/auth/config` exposes only this public client ID so the frontend can load it at runtime; frontend `VITE_GOOGLE_CLIENT_ID` remains a compatibility fallback. The Google option appears on login and registration; when no client ID is configured it is disabled with an availability message, and the sign-in API returns 503. Google tokens are verified server-side with the Google library. Matching emails are never silently linked to existing accounts. See [Google's verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) and [OWASP's CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Documents and conversations

All `/api/documents`, `/api/rag`, and `/api/chats` routes require an active session. Upload `file` as multipart PDF to `/api/documents/upload` (10 MB maximum). Process with `POST /api/documents/:documentId/process`. Metadata, PDF file reads (`/:documentId/file` and `/:documentId/view`), indexing, deletion and legacy RAG requests all check ownership in MongoDB. Files are never mounted as a public static directory. Unowned legacy documents stay inaccessible; reupload them after signing in or perform an explicitly reviewed administrative migration. No automatic ownership assignment is performed.

| Endpoint | Purpose |
| --- | --- |
| POST /api/chats | `{documentId}` creates a conversation for an owned, indexed PDF |
| GET /api/chats?documentId=... | Latest 100 conversations for one owned PDF |
| GET /api/chats/:chatId/messages | Saved messages, chronological within each page |
| POST /api/chats/:chatId/messages | `{question,requestId}` generates and saves a full turn |

Use a stable UUID `requestId` when retrying a send. Repeated IDs return the saved result and reject a changed question. History always comes from MongoDB. A successful send returns `data.chatId`, `data.userMessage` and `data.assistantMessage` (with compatible `messages`, `question` and `answer` aliases). Questions are limited to 4,000 characters, answers to 20,000. Messages accept `limit=1..100` (default 50) and `before=<oldest message ID>`; `pagination.hasMore` and `pagination.before` support loading older messages.

A renewable database lease serializes answering, processing and deletion for each document. Busy operations return 409. A pending-turn journal in the chat lets a later read or send recover interrupted message persistence without requiring a replica-set MongoDB. Model failures leave no user-only turn. Document deletion removes vectors, files, messages and conversations; failed cleanup can be retried. Lease recovery after a crashed process can take up to ten minutes. Request/answer/document text is not logged.

## Validation and deployment scope

`npm test` uses a temporary MongoDB instance and stubbed external Google/AI/vector calls. It covers registration/login, cookies, CSRF, ownership on all entry points, two candidate histories, idempotency, pagination, interrupted writes, concurrent operations, replay revocation and logout. The first run may download a MongoDB test binary. Frontend tests run with `npm test` in its directory, and its production bundle with `npm run build`.

Email verification, password reset/recovery, authenticated Google account linking, device/session management, distributed rate-limit storage and deployment-specific HTTPS/private persistent storage remain separate production work. Rate limits currently use process memory. Real Google sign-in requires your OAuth credentials; AI indexing and generation require your running Ollama and Chroma services.

The completed browser validation used the [Playwright skill](C:/Users/ASUS/.agents/skills/playwright/SKILL.md) and an isolated test MongoDB with deterministic AI responses. It verified registration, real PDF upload/preview, candidate switching, follow-up history, new and reopened conversations, reload persistence, session refresh, two-user isolation, logout/login and the mobile sign-in layout. The backend suite covers 17 scenarios; the frontend suite currently covers 18 tests. External Google and AI services were simulated; live service verification still requires configured credentials and running services.

Dependency audit: npm currently reports five advisories in the existing default-embedding and development-tool dependency trees. No forced dependency upgrades were applied. Review these before a public deployment.
