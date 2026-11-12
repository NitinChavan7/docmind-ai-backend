# Chat module

This module keeps separate conversations for each user's PDF. It loads conversation memory from MongoDB, calls document RAG and saves completed turns. It supports both a full JSON response and token-by-token SSE over POST fetch.

## Files and libraries

| File | Purpose | Dependencies |
| --- | --- | --- |
| [index.js](index.js) | Conversation routes and shared generation request limiter | `express`, `express-rate-limit` |
| [controller/index.js](controller/index.js) | Validate IDs/input, check ownership, coordinate history/generation/persistence | `mongoose`, Node `crypto`, repositories/services, SSE helpers |
| [repository/index.js](repository/index.js) | Query chats/messages and recoverably save a completed turn | Mongoose models |
| [services/generation.service.js](services/generation.service.js) | Count active generation work | Plain JavaScript `Map`, generation config |

The controller takes the user ID from `req.user.id` and loads history from MongoDB. Clients send the current question. See the [Chat](../database/models/Chat.README.md) and [Message](../database/models/Message.README.md) model guides.

## Routes and controller functions

All paths start with `/api/chats`; parent middleware applies auth and CSRF for mutations.

| Route | Function | Result |
| --- | --- | --- |
| POST `/` | `create(req,res)` | Creates a chat for `{documentId}` only if the owned document is ready |
| GET `/?documentId=...` | `list(req,res)` | Lists latest 100 owned conversations for one PDF |
| GET `/:chatId/messages` | `messages(req,res)` | Recovers a pending turn, then returns saved messages and pagination |
| POST `/:chatId/messages` | `ask(req,res)` | Generates a full answer, saves both messages and returns JSON |
| POST `/:chatId/stream` | `stream(req,res)` | Streams progress, metadata and answer deltas; saves completed turn |
| DELETE `/:chatId` | `remove(req,res)` | Deletes an owned chat/messages under the parent lease; retains daily charges |

Controller helpers: `validId(value)` validates MongoDB ID shape; `fail(status,message)` throws an HTTP-aware error; `ownedChat(req)` checks chat ownership. Each caller then acquires the owner-scoped document lease, which verifies that the associated document exists and belongs to the user before history is read or generation starts. Missing or unowned records return 404.

`messages` accepts `limit=1..100` (default 50) and optional `before=<message ID>`. Repository results are newest-first internally; the response reverses each page into chronological order. `pagination.before` is the oldest returned ID for the next older page.

`ask` accepts `{question,requestId?}`. It checks the ready document, recovers any pending turn, returns an already-saved matching request ID when present, loads eight recent committed messages, calls `askDocument` and saves the result. A reused ID with different question text returns 409. Questions are limited to 4,000 characters and answers to 20,000.

`stream` accepts `{question,requestId?}`; mode routing/web search do not exist, so supplied `mode` is rejected. It loads the same eight-message memory, reserves message IDs, sends SSE through `streamDocument`, checks completion/cancellation and saves using the existing journal. It handles actual response disconnects, a generation deadline, heartbeat comments and safe terminal errors. See the [full streaming contract](../../docs/STREAMING.md), including the persistence commit boundary.

## Repository functions

| Function | Meaning / result |
| --- | --- |
| `scope(chat)` (internal) | Builds `{userId,documentId,chatId}` for message queries |
| `getOwnedDocument(userId,documentId)` | Lean document or null |
| `getOwnedChat(userId,chatId)` | Lean chat including its normally hidden pending journal |
| `getChats(userId,documentId)` | Latest 100 chats by activity and ID |
| `createChat(userId,documentId)` | New chat after account-wide quota check under the usage lease |
| `getMessages(chat,before,limit)` | Committed, scoped messages newest first |
| `getTurn(chat,requestId)` | Committed user/assistant pair ordered by ID |
| `saveTurn(chat,requestId,question,result,messageIds?)` | Journals the full answer, then recovers/writes both messages |
| `recoverTurn(chat)` | Upserts pending messages, marks committed, updates chat activity/title, clears journal |

`result` is `{answer,sources}`. Optional `messageIds` is `{user,assistant}`, used to match the streamed `meta.messageId` to the stored assistant ID. Reads and writes using the journal must hold the document lease; the repository is not independently locking itself.

The journal stores only fully generated answers. It allows recovery without requiring a MongoDB replica-set transaction. This does not make every multi-record update atomic by itself: protected application readers take the lease and recover first. A failed/cancelled generation before journaling saves no orphan question or partial answer. A disconnect during commit may still leave a complete saved answer; reload history before retrying.

## Concurrency and usage

The free plan adds MongoDB-backed daily/per-chat quotas, a rolling per-user minute limit and distributed concurrency leases. Admission happens before SSE headers. Completed request IDs replay across JSON/SSE without a second charge; started failures remain charged and pre-generation failures release their reservation. New chats and uploads receive explicit expiry timestamps. See [the free-plan contract](../../docs/FREE_PLAN.md).

`withGenerationSlot(userId,operation)` increments process-local global/user counters, runs the callback and decrements counters in `finally`. Capacity exhaustion returns 429. It is shared with JSON chat and legacy RAG. Defaults: four global generations, one per user. The JSON/stream routes also share a default 20 requests/minute/IP limiter. The database document lease separately prevents conflicting work on the same PDF across backend instances.

Example: POST `/api/chats` with `{"documentId":"OWNED_READY_ID"}`, then POST `/:chatId/messages` with `{"question":"What skills are listed?","requestId":"a-stable-request-uuid"}`. Preserve auth cookies and send `X-CSRF-Token` on both POSTs. For streaming, use authenticated fetch and append only `token.text` deltas; mark saved only on `done`.
