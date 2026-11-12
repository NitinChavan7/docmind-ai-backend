# Libraries used by this backend

The versions below are dependency ranges declared in [package.json](../package.json), not a claim that every machine resolves the same installed version. `package-lock.json` records resolved versions; `npm ls --depth=0` reports the local installation.

## Application packages

| Package | Declared range | Where / why it is used |
| --- | --- | --- |
| `express` | `^5.3.0` | HTTP app, routers, JSON parsing, requests and responses |
| `cors` | `^2.8.6` | Allows configured frontend origins and credentialed browser requests |
| `helmet` | `^8.3.0` | Sets HTTP security headers in `app.js` |
| `cookie-parser` | `^1.4.7` | Populates `req.cookies` for session and CSRF middleware |
| `dotenv` | `^18.0.9` | Loads local `.env` before server/service setup |
| `mongoose` | `^9.12.0` | MongoDB schemas, validation, indexes, queries and writes |
| `bcryptjs` | `^3.0.3` | Hashes/compares local account passwords |
| `jsonwebtoken` | `^9.0.3` | Signs/verifies application access and refresh JWTs |
| `google-auth-library` | `^10.9.1` | Verifies Google ID tokens on the backend |
| `express-rate-limit` | `^8.7.3` | Limits authentication attempts and chat generation requests |
| `multer` | `^2.5.0` | Multipart PDF upload storage, MIME filtering and size limit |
| `pdf-parse` | `^2.4.5` | `PDFParse` extracts page count and text from uploaded PDFs |
| `@qdrant/js-client-rest` | `^1.20.0` | Qdrant inference inputs, collection reads, vector insert/search/delete |
| `@supabase/supabase-js` | `^2.109.0` | Private PDF object upload, download and deletion |
| `ws` | `^8.22.2` | WebSocket transport configured for the Supabase client |
| `chromadb` | `^3.5.0` | Retained package from the previous vector integration; not used by the active service |
| `@chroma-core/default-embed` | `^0.1.9` | Retained legacy dependency; active embedding inference runs through Qdrant |

## Development packages

| Package | Declared range | Purpose |
| --- | --- | --- |
| `nodemon` | `^3.1.14` | Restarts the backend during `npm run dev` |
| `mongodb-memory-server` | `^11.3.0` | Runs isolated MongoDB in tests |
| `supertest` | `^7.3.1` | Tests HTTP handlers without manually managing an app server |

## Built-in APIs, not npm libraries

Node `crypto` creates random identifiers and hashes/HMACs. `fs`/`fs/promises` handle PDFs; `path` resolves storage locations. `fetch` calls Groq. `AbortController`/`AbortSignal` implement deadlines/cancellation. Web streams and `TextDecoder` decode UTF-8 incrementally; `events.once` handles write backpressure. `node:http` creates test HTTP servers; `node:test` and `node:assert/strict` run assertions.

## External services, not npm libraries

MongoDB stores application records. Supabase stores private PDFs. Qdrant stores/searches chunks and runs embedding inference; Groq generates text. Google Identity Services provides the browser's Google sign-in credential, which the backend verifies. Installing a JavaScript client package does not provision these services or configure their credentials.

React and `@react-oauth/google` belong to the sibling frontend project, not this backend's dependency list. See [module documentation](../modules/README.md) to understand which functions call each package.
