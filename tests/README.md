# Backend tests

Run from the backend root:

```powershell
npm test
```

[package.json](../package.json) explicitly runs the three automated test files below using Node's built-in test runner. A temporary MongoDB binary may be downloaded on first use. The tests do not require your real user account or production database.

## Libraries and APIs

| Dependency | Why it is used |
| --- | --- |
| Node `node:test`, `node:assert/strict` | Test lifecycle, assertions and subtests |
| `mongodb-memory-server` | Launches isolated temporary MongoDB for real Mongoose queries/indexes |
| `supertest` | Sends requests to the imported Express app in multi-user tests |
| `mongoose` | Exercises the actual models and repositories |
| `jsonwebtoken` | Constructs expired access-token fixtures |
| Node `http`, `fetch`, Web streams, `crypto`, `fs/promises` | Real HTTP mock upstreams, streaming, temporary identities and upload cleanup |

## Files and coverage

| File | What it verifies | External work simulated |
| --- | --- | --- |
| [multi-user.test.js](multi-user.test.js) | Accounts, cookies, CSRF/session binding, owned document routes, candidate histories, retries, recovery, overlapping operations, replay/expiry/logout and deletion | Google token verifier, PDF extraction, embeddings, vectors, answer generation |
| [stream-parser.test.js](stream-parser.test.js) | Split UTF-8/NDJSON/SSE, invalid/oversized records, blocked-reader cancellation, lock cleanup and writer backpressure | In-memory byte streams and a response EventEmitter |
| [streaming.test.js](streaming.test.js) | Auth/ownership/origin/CSRF, real HTTP event order/deltas, citations and IDs, stored memory, fallback, upstream failures, aborts, timeout, caps/rate limit and saving failures | Local HTTP Ollama server and Chroma retrieval; MongoDB remains real and temporary |

The multi-user `Client` helper stores response cookies and obtains CSRF before mutations. Streaming tests use a separate client helper plus real fetch against a local Express listener. The mock Ollama server handles rewriting, 768-number embedding fixtures and streamed responses, including deliberately broken or never-ending responses.

These tests exercise backend behavior and deterministic mock outputs. They do not prove live model quality, actual Google configuration, production proxy flushing or a deployed frontend's rendering.

## Browser fixture

[browser-server.js](browser-server.js) is an optional development fixture, not part of `npm test`. Run `node tests/browser-server.js`; it listens on `127.0.0.1:5101`, allows frontend origin `http://localhost:5174`, generates temporary JWT secrets and uses temporary MongoDB. It keeps real PDF parsing/files while stubbing embeddings, vector writes/deletes and the non-streaming RAG answer. The synthetic two-number embeddings are not the production model's vector space. The streaming RAG path is not stubbed by this fixture.

Its `stop()` handler attempts file/database cleanup on SIGINT/SIGTERM. Uploaded fixture PDFs use the normal local upload directory, so stop the fixture cleanly when finished. It is not a production launch command.
