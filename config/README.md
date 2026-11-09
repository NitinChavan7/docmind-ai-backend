# Configuration

These files centralize MongoDB setup, authentication settings and generation limits. Actual values come from environment variables; [server.js](../server.js) loads `.env` with `dotenv` before importing the application. Use [.env.example](../.env.example) as a variable-name template, not a source of real secrets.

## Functions and dependencies

| File/function | Purpose | Dependency |
| --- | --- | --- |
| [db.js](db.js): `connectDB()` | Connects using `MONGO_URI`; logs status; rethrows failures | `mongoose` |
| [auth.js](auth.js): `validateAuthConfig()` | Requires two different JWT secrets, each at least 32 characters | Plain JavaScript |
| Same file: `cookieBase()` | Returns HttpOnly, SameSite=Lax and production Secure options | `NODE_ENV` |
| Same file: `accessLifetime`, `refreshLifetime` | Millisecond constants: 15 minutes / seven days | None |
| [generation.js](generation.js): `integer(name,fallback,max)` (internal) | Reads a positive bounded integer or uses fallback | `process.env` |
| Same file: `generationTimeoutMs()` | Streaming deadline; default 180000, max 600000 | None |
| Same file: `maxGenerations()` | In-process total generation cap; default 4, max 100 | None |
| Same file: `maxUserGenerations()` | In-process user cap; default 1, max 10 | None |
| Same file: `generationRateLimit()` | JSON/stream requests/minute/IP; default 20, max 120 | None |

## Environment variable reference

| Variable | Default / requirement | Consumer |
| --- | --- | --- |
| `PORT` | 5000 | Server listener |
| `MONGO_URI` | Required for normal startup | MongoDB connector |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Required, independent, 32+ characters | Token/CSRF services |
| `JWT_ISSUER` | `docmind-ai` | JWT signing/verification |
| `JWT_AUDIENCE` | `docmind-ai-web` | JWT signing/verification |
| `NODE_ENV` | Production cookies become Secure when exactly `production` | Cookie config, error detail behavior |
| `CLIENT_URL` | `http://localhost:5173`; comma-separated origins accepted | CORS/origin policy |
| `GOOGLE_CLIENT_ID` | Optional; Google login unavailable when missing | Verified Google ID-token audience; public config endpoint |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Embedding and LLM HTTP services |
| `OLLAMA_CHAT_MODEL` | `llama3.2:3b` | Rewriting/answer generation |
| `CHROMA_URL` | `http://127.0.0.1:8000` | Chroma client |
| `CHROMA_COLLECTION` | `document_chunks` | Vector collection |
| `GENERATION_TIMEOUT_MS` | 180000 | Streaming controller |
| `MAX_CONCURRENT_GENERATIONS` | 4 | Shared generation service |
| `MAX_USER_GENERATIONS` | 1 | Shared generation service |
| `GENERATION_RATE_LIMIT` | 20 | JSON/stream chat request limiter |

There is no configurable embedding-model name in this version: the service uses `nomic-embed-text`. Most service host/model settings are captured when modules load; restart the backend after changing environment values. Generation helper functions read their values when called.

Use HTTPS and appropriate same-site deployment domains for production cookies. Configure a specifically trusted reverse proxy if required; this code does not blindly enable `trust proxy`. Capacity and rate-limit counters are process-local, while document operation leases are in MongoDB.

The other MongoDB helper at [modules/database/config.js](../modules/database/config.js) is not the connector used by the current server startup. See the [database guide](../modules/database/README.md).
