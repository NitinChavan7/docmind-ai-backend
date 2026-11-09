# Middleware

Middleware runs before controllers to parse/validate a request or restrict an operation. [app.js](../app.js) installs JSON parsing, cookies, origin checks and app-level security headers/CORS. [modules/index.js](../modules/index.js) applies authentication and CSRF before protected modules.

## Functions, files and libraries

| File/function | What it checks or changes | Dependencies |
| --- | --- | --- |
| [auth.middleware.js](auth.middleware.js): `requireAuth(req,res,next)` | Verifies access JWT, checks live unexpired session and user, attaches `req.user={id,sessionId}` | Mongoose `User`/`AuthSession`, token service |
| [origin.middleware.js](origin.middleware.js): `allowedOrigins()` | Splits/trims `CLIENT_URL`, defaulting to localhost:5173 | Plain JavaScript |
| Same file: `verifyOrigin(req,res,next)` | Allows safe methods; rejects untrusted mutation Origin or missing-Origin cross-site browser request | Express request/response APIs |
| [csrf.middleware.js](csrf.middleware.js): `issueCsrf(req,res)` | Creates/reuses HttpOnly seed cookie and returns session-bound digest | Node `crypto`, auth config/token service |
| Same file: `verifyCsrf(req,res,next)` | Checks `X-CSRF-Token` against seed/session HMAC using timing-safe comparison; safe methods pass | Node `crypto` |
| [upload.middleware.js](upload.middleware.js): exported `upload` | Multer instance writing private PDFs with generated names | `multer`, Node `fs`, `path`, `crypto` |
| [document-operation.middleware.js](document-operation.middleware.js): `documentOperation(handler)` | Validates document ID, runs handler inside shared document lease, forwards errors | `mongoose`, document operation service |

## Internal helpers

CSRF `binding(req)` verifies a signed access/refresh token (ignoring only expiry for this binding operation) and chooses its session ID; otherwise it uses an anonymous binding. `digest(seed,req)` HMACs seed plus binding with `JWT_ACCESS_SECRET`. This does not authenticate a request by itself; `requireAuth` still verifies token/session expiry normally.

Upload `storage.destination` selects `uploads/`; `storage.filename` uses `crypto.randomUUID()` plus `.pdf`; `fileFilter` accepts `application/pdf`. The limit is 10 MiB. The controller then checks `%PDF-` content and removes failed uploads; MIME filtering alone is not content validation. The upload module creates the directory if absent.

## Request ordering and use

1. Express applies security headers/CORS, JSON parsing and `cookie-parser`.
2. Mutations pass `verifyOrigin`; auth routes also receive CSRF checking.
3. Protected document/chat/RAG routes pass `requireAuth`, then CSRF checking. Checking auth first lets expired access return 401 and be refreshed before retrying a mutation.
4. Document upload uses `upload.single('file')`; processing/deletion use `documentOperation`.

Example route wiring is in [document/index.js](../modules/document/index.js). Authentication failure returns 401; rejected origin/CSRF returns 403 (`CSRF_INVALID` for a CSRF mismatch); an owned document operation can return 409 when busy.

Fetch clients must include cookies and send the issued CSRF header on mutations, including login. CORS is a browser access policy, not proof of user identity. JWTs, session existence, owner-scoped database queries and CSRF each serve different purposes. See [auth](../modules/auth/README.md) and [configuration](../config/README.md).
