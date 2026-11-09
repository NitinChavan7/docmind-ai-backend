# Streaming document answers

The existing `POST /api/chats/:chatId/messages` JSON endpoint still works. The new endpoint is **`POST /api/chats/:chatId/stream`** and returns SSE over a normal authenticated POST fetch. This change is confined to the backend; a React consumer must opt into this endpoint. It does not use EventSource or WebSockets.

```json
{ "question": "Where is the candidate located?" }
```

Use `Content-Type: application/json`, `Accept: text/event-stream`, the current `X-CSRF-Token` and `credentials: 'include'`. The question must be a nonblank string of at most 4,000 JavaScript characters. This repository has only document RAG: there is no existing mode router or web search, so omit `mode`. Supplied modes are rejected with 400 rather than silently implementing another system. `meta.mode` is the descriptive label `document`.

Authentication, session revocation, origin/CORS and CSRF checks are the same as the protected JSON route. Chat and document ownership are checked before any Ollama or retrieval call. `userId`, `history`, `sources`, model names and similar body fields cannot override server-owned values. Responses never expose private paths, tokens, upstream error bodies or stack traces.

## Wire format

Every dispatched event has exactly this framing (JSON strings escape embedded line breaks):

```text
event: status
data: {"stage":"understanding"}

event: status
data: {"stage":"retrieving"}

event: meta
data: {"chatId":"...","messageId":"...","mode":"document","sources":[{"documentId":"...","pageNumber":1,"chunkNumber":1,"content":"Relevant PDF excerpt","distance":0.1}]}

event: status
data: {"stage":"generating"}

event: token
data: {"text":"The candidate"}

event: token
data: {"text":" is located in Pune."}

event: done
data: {"chatId":"...","messageId":"...","status":"completed"}

```

The `messageId` reserved in `meta` is the MongoDB assistant message ID stored on success and repeated in `done`. Sources retain the existing PDF citation format. Tokens are deltas, not the accumulated answer; concatenate `data.text`. Statuses are emitted only when their work runs. The existing no-context fallback sends `understanding`, `retrieving`, `meta` with empty sources, a fallback `token`, and `done`; no model generation stage is announced. `searching_web` is reserved by the client contract and never emitted because no web search exists here.

The server sends `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, and `X-Accel-Buffering: no`, flushes headers, respects write backpressure, and sends `: keep-alive` comment frames every 15 seconds while writable. Token arrival still depends on model speed, fetch buffering and your proxy/browser. Configure reverse-proxy idle timeouts above the generation deadline and disable response buffering/compression for this route.

## Errors, cancellation and persistence

Before SSE headers: ordinary JSON `{success:false,message:"..."}` with 400 for invalid input/ID/mode, 401 for authentication, 403 for CSRF/origin, 404 for missing or unowned resources, 409 for an unready/busy document, and 429 for generation capacity or request limits. A preparation timeout before headers returns 504; an unexpected preparation failure returns 503. Existing middleware retains its own error behavior.

After headers: HTTP status remains 200; consumers **must** inspect terminal events:

```text
event: error
data: {"message":"We could not finish this answer. Please try again."}

event: cancelled
data: {"status":"cancelled"}

```

Errors end the response without `done`. A deadline error says the answer took too long. A truncated NDJSON response, malformed record, invalid UTF-8, upstream error record, empty answer, or length violation cannot produce a successful `done`. The Ollama stream must reach `done:true`.

Abort the frontend fetch with its AbortController to stop generation. The server listens to actual request abortion and **response** close; it does not mistake a normal parsed request-body close for a disconnect. Cancellation propagates through rewriting, embeddings, Chroma read requests and Ollama streaming; readers, timers, capacity slots and the document lease are cleaned up. A disconnected browser normally cannot receive a `cancelled` event because it has closed the transport. Mark the local UI cancelled immediately; the server emits that event only when the transport remains writable. An open stream is authenticated at admission, like the existing JSON request; logout does not retroactively stop work on another already-open connection, so the frontend should abort outstanding fetches on logout.

**Persistence policy:** do not write either side of a turn until a complete, nonempty answer is generated. A failure/cancellation before this point leaves no user-only message and no partial assistant answer. Once generation completes, cancellation is checked and the existing pending-turn journal becomes the commit point. Both messages are then saved with user/document/chat ownership and the chat title/time is updated. If the connection closes during this database commit, the full generated answer may still be saved. If a database write is interrupted after journaling, the existing history/read retry recovers the complete pair; `done` is emitted only after persistence and lease cleanup succeed. After a lost connection or saving error, reload `GET /api/chats/:chatId/messages` before retrying. This streaming endpoint does not promise request idempotency; the existing JSON endpoint retains its `requestId` behavior.

## Limits

| Setting                      | Default | Scope                                                                               |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `GENERATION_TIMEOUT_MS`      | 180000  | Streaming preparation + generation, maximum configured value 600000                 |
| `MAX_CONCURRENT_GENERATIONS` | 4       | In-process generation slots across streaming, JSON chat and legacy RAG              |
| `MAX_USER_GENERATIONS`       | 1       | In-process slots per user                                                           |
| `GENERATION_RATE_LIMIT`      | 20      | Shared streaming/JSON chat requests per minute per IP; maximum configured value 120 |

Invalid configuration values use the defaults. Ollama rewrite/embed/chat calls also retain a 120-second upstream deadline. The document lease continues to serialize conflicting operations across backend instances. Generated answers are limited to 20,000 characters; upstream NDJSON is limited to 4 MiB and 131,072 characters per record. Incoming JSON retains the app's 1 MiB cap. Rate limits and capacity counters are process-local; use shared infrastructure for a fleet-wide budget. A completed generation's recoverable database commit/cleanup can outlast a generation deadline during a database outage; the journal is deliberately not abandoned halfway through committing a full answer.

The implementation shares the original prompt builder, question rewriting, MongoDB history and retrieval/context builder with non-streaming answers. It uses the existing `OLLAMA_BASE_URL` and `OLLAMA_CHAT_MODEL` (default `llama3.2:3b`), and existing `nomic-embed-text` embeddings without changing dimensions. See [Ollama chat API](https://docs.ollama.com/api/chat) and [NDJSON streaming format](https://docs.ollama.com/api/streaming).

## Windows verification

Run MongoDB, Chroma and Ollama, pull the existing models if needed, then start the backend:

```powershell
ollama pull llama3.2:3b
ollama pull nomic-embed-text
npm run dev
```

In another PowerShell window, log in with an existing account. `Get-Credential` asks for your email and password without putting the password in command history:

```powershell
$base = 'http://localhost:5000/api'
Invoke-WebRequest "$base/auth/csrf" -SessionVariable session -UseBasicParsing | Out-Null
$csrf = (Invoke-RestMethod "$base/auth/csrf" -WebSession $session).data.csrfToken
$credential = Get-Credential -Message 'DocMind email and password'
$login = @{ email = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json -Compress
Invoke-RestMethod "$base/auth/login" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{ 'X-CSRF-Token' = $csrf } -Body $login | Out-Null
$csrf = (Invoke-RestMethod "$base/auth/csrf" -WebSession $session).data.csrfToken
```

Choose an **owned and ready** document from `GET /documents`, then create a conversation (or use an existing owned chat ID):

```powershell
(Invoke-RestMethod "$base/documents" -WebSession $session).data | Format-Table documentId, originalName, status
$documentId = Read-Host 'Owned ready document ID'
$chatBody = @{ documentId = $documentId } | ConvertTo-Json -Compress
$chatId = (Invoke-RestMethod "$base/chats" -Method Post -WebSession $session -ContentType 'application/json' -Headers @{ 'X-CSRF-Token' = $csrf } -Body $chatBody).data._id
```

Use **curl.exe** for an unbuffered live response; PowerShell's `Invoke-RestMethod` normally buffers the body. Export only cookies matching the chat URL (the refresh cookie has a narrower `/api/auth` path):

```powershell
$cookieHeader = ($session.Cookies.GetCookies([uri]"$base/chats/$chatId/stream") | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; '
$requestFile = Join-Path $env:TEMP 'docmind-stream-question.json'
[System.IO.File]::WriteAllText($requestFile, '{"question":"Where is the candidate located?"}')
curl.exe --no-buffer --request POST "$base/chats/$chatId/stream" --cookie "$cookieHeader" --header "X-CSRF-Token: $csrf" --header 'Content-Type: application/json' --header 'Accept: text/event-stream' --data-binary "@$requestFile"
Remove-Item -LiteralPath $requestFile
```

Press **Ctrl+C while tokens are still arriving** to cancel. Cancellation before completion should add zero messages. Check history after a short cleanup interval:

```powershell
(Invoke-RestMethod "$base/chats/$chatId/messages?limit=50" -WebSession $session).data | Select-Object _id, role, content
```

For a Node 20 consumer that parses SSE and prints tokens as text:

```powershell
$env:DOCMIND_COOKIE = $cookieHeader
$env:DOCMIND_CSRF = $csrf
$env:DOCMIND_API_URL = $base
node scripts/stream-chat.js $chatId 'Summarize this candidate briefly.'
# Ctrl+C aborts fetch. Clear the temporary session environment afterward:
Remove-Item Env:DOCMIND_COOKIE, Env:DOCMIND_CSRF, Env:DOCMIND_API_URL
```

For browser React integration, obtain CSRF through your existing API client, then use POST `fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({question}),signal:controller.signal})`. Refresh authentication only for a 401 before reading the stream. Do not automatically retry after receiving tokens or losing a terminal event; check saved history first. Feed `response.body` into an incremental UTF-8/SSE parser, append token deltas to one draft answer, replace its temporary ID with `meta.messageId`, and mark it saved only on `done`. The CommonJS `utils/stream.js` and Node example demonstrate parsing; the frontend can adapt the same logic to its module/build system.

Run all backend checks:

```powershell
npm test
```

The tests use a real local HTTP mock Ollama server and temporary MongoDB, not a live production account/model. They cover decoding, backpressure, event order, citations, saved IDs/history, ownership, CSRF/CORS, errors, disconnects, timeouts, limits and persistence failures. The first run may download a MongoDB test binary. This repository has no configured lint or build script.

## Files changed for this feature

Created:

- `config/generation.js`
- `modules/chat/services/generation.service.js`
- `utils/stream.js`
- `utils/sse.js`
- `scripts/stream-chat.js`
- `tests/stream-parser.test.js`
- `tests/streaming.test.js`
- `docs/STREAMING.md`

Modified:

- `app.js`
- `package.json`
- `.env.example`
- `README.md`
- `modules/chat/index.js`
- `modules/chat/controller/index.js`
- `modules/chat/repository/index.js`
- `modules/document/services/operation.service.js`
- `modules/rag/controller/index.js`
- `modules/rag/repository/index.js`
- `modules/rag/services/llm.service.js`
- `modules/rag/services/rag.service.js`
- `modules/rag/services/embedding.service.js`
- `modules/rag/services/vector.service.js`

No new packages, collection migrations, frontend changes, or replacement project structure are required.
