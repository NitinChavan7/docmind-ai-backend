# Backend configuration

[server.js](../server.js) loads `.env` before importing the app, validates JWT secrets, connects MongoDB and initializes model indexes. Cloud clients are constructed when their modules are imported. Restart the server after changing connection or model settings.

| File | Purpose |
| --- | --- |
| [db.js](db.js) | Connect Mongoose using `MONGO_URI` |
| [auth.js](auth.js) | Validate secrets and set cookie options/lifetimes |
| [generation.js](generation.js) | Read bounded generation settings |
| [usage-limits.js](usage-limits.js) | Validate all eleven free-plan settings at startup |
| [qdrant.js](qdrant.js) | Construct the Qdrant REST client |
| [supabase.js](supabase.js) | Construct the server-side Supabase client; disable persisted/refreshing auth and provide the `ws` transport |

## Environment variables

| Variable | Default or requirement |
| --- | --- |
| `PORT` | `5000` |
| `NODE_ENV` | Set `production` for Secure cookies and production proxy settings |
| `MONGO_URI` | Required MongoDB connection URI; local MongoDB or Atlas |
| `CLIENT_URL` | `http://localhost:5173`; accepts comma-separated allowed origins |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Two different values, each at least 32 characters |
| `JWT_ISSUER` | `docmind-ai` |
| `JWT_AUDIENCE` | `docmind-ai-web` |
| `GOOGLE_CLIENT_ID` | Optional public Google Web OAuth client ID |
| `SUPABASE_URL` | Required Supabase project URL |
| `SUPABASE_SECRET_KEY` | Required server-side Supabase secret |
| `SUPABASE_BUCKET` | Required private PDF bucket name |
| `QDRANT_URL`, `QDRANT_API_KEY` | Qdrant cluster URL and API key |
| `QDRANT_COLLECTION` | `document_chunks_v2` in the active vector service |
| `QDRANT_EMBEDDING_MODEL` | `sentence-transformers/all-minilm-l6-v2` |
| `GROQ_API_KEY` | Required for rewriting/generation calls |
| `GROQ_MODEL` | `openai/gpt-oss-20b` |
| `GROQ_REASONING_EFFORT` | `low`; accepts `low`, `medium`, `high` for GPT-OSS 20B/120B; omitted for other models |
| `QUESTION_REWRITE_TIMEOUT_MS` | `8000`; positive integer up to `120000`; timeout falls back to the original question |
| `GENERATION_TIMEOUT_MS` | `180000`; positive integer up to `600000` |
| `MAX_CONCURRENT_GENERATIONS` | `4`; positive integer up to `100` |
| `MAX_USER_GENERATIONS` | `1`; positive integer up to `10` |
| `GENERATION_RATE_LIMIT` | `20` chat requests/minute/IP; positive integer up to `120` |

Generation helpers read settings when called and fall back to defaults for invalid values. Capacity and rate limits are per process; document leases use MongoDB.

The checked-in [.env.example](../.env.example) includes current cloud variables and every `FREE_*` default. Quota values must be positive integers; invalid values stop startup. See [the free-plan guide](../docs/FREE_PLAN.md) for the exact local/Render settings, quota semantics, retention backfill and external cleanup scheduler. Ollama/Chroma variables do not configure the active services.

Access cookies last 15 minutes; refresh cookies last seven days. Both are HttpOnly and SameSite=Lax, with Secure enabled in production. Use HTTPS and compatible same-site frontend/API routing. [app.js](../app.js) trusts one proxy hop in production and disables proxy trust otherwise; verify the deployed proxy chain.

The separate [modules/database/config.js](../modules/database/config.js) connector is not used by normal startup. Secrets belong in local/deployment configuration and must never be exposed through frontend `VITE_` variables.
