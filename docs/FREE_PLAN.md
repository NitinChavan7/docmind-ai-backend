# Free-plan limits and retention

The backend enforces account quotas in MongoDB before admitting uploads, conversations or answers. Existing JWT cookies, CSRF, ownership filters, Supabase storage, Qdrant retrieval and the chat persistence journal remain in use. There are no payment or billing integrations.

## Configuration

Set the following values in local `.env` and Render's environment settings. Defaults apply only when a variable is absent. Empty strings, zero, negative values, fractions, non-numeric values and values above 1,000,000 stop startup with the variable name in the error. Restart after changing limits. MB values use 1,048,576 bytes.

```dotenv
FREE_MAX_PDFS=5
FREE_MAX_PDF_SIZE_MB=10
FREE_MAX_TOTAL_STORAGE_MB=30
FREE_MAX_PDF_PAGES=25
FREE_MAX_CHATS=10
FREE_MAX_QUESTIONS_PER_CHAT=50
FREE_MAX_DAILY_QUESTIONS=30
FREE_MAX_CHAT_REQUESTS_PER_MINUTE=5
FREE_MAX_CONCURRENT_GENERATIONS=1
FREE_PDF_RETENTION_DAYS=30
FREE_CHAT_RETENTION_DAYS=30
```

The complete service environment is in [`.env.example`](../.env.example). For local use, set `NODE_ENV=development`, `CLIENT_URL=http://localhost:5173`, and `MONGO_URI` to your development database. On Render, use `NODE_ENV=production`, set `CLIENT_URL` to the exact Vercel frontend origin, and use the Atlas URI in `MONGO_URI`. Render supplies its listening `PORT`.

Both environments also need independent `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values of at least 32 characters, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_BUCKET`, `QDRANT_URL`, `QDRANT_API_KEY`, and `GROQ_API_KEY`. Keep the Supabase bucket private. The current model defaults are `QDRANT_COLLECTION=document_chunks_v2`, `QDRANT_EMBEDDING_MODEL=sentence-transformers/all-minilm-l6-v2`, and `GROQ_MODEL=openai/gpt-oss-20b`. `GOOGLE_CLIENT_ID` is required only for Google sign-in. Keep provider keys on the backend.

`GENERATION_RATE_LIMIT` still limits chat generation by IP (default 20/minute). `MAX_CONCURRENT_GENERATIONS` and `MAX_USER_GENERATIONS` still cap work within each process (defaults 4 and 1). The MongoDB-backed account limits apply in addition, across processes. Increasing a free-plan concurrency limit does not automatically raise those existing safeguards.

## Uploads and storage accounting

The server checks MIME, signature, actual bytes and PDF structure. `pdf-parse` inspects page count before any upload or inference. Exact file-size and storage boundaries are accepted; one byte over the file limit is rejected. Encrypted, malformed, empty and unsupported files receive `INVALID_PDF_FILE`. Scanned PDFs can be valid uploads but cannot be indexed without extractable text; OCR is still unavailable.

Under a MongoDB user lease, the server checks document count and bytes and creates a pending `Document` record. That record reserves capacity before Supabase is called. Pending uploads are hidden from document reads. Unexpired pending deletion records keep their PDF/storage capacity until cleanup succeeds. Expired PDFs are unavailable and no longer count as active capacity, even while physical cleanup awaits the scheduler.

SHA-256 of the actual file bytes provides upload retry deduplication within an account. Retrying identical content returns the existing completed document, including its original name and ID. An identical upload still in progress returns `409 UPLOAD_IN_PROGRESS` with `Retry-After: 2`. The hash is not shared across users. A failed remote upload leaves durable metadata for cleanup if compensation fails. Abandoned pending uploads become cleanup candidates after ten minutes; an active document lease prevents cleanup from racing the upload.

Temporary upload files are removed after validation and storage attempts. Processing inspects the stored PDF again before extraction/indexing, including for legacy uploads. Page count, size, owner and usage values from request JSON are never used for quota decisions.

## Question admission, retries and charging

JSON chat, SSE chat and `/api/rag/ask` share the daily, per-minute and distributed concurrency checks. Chat endpoints also enforce 50 accepted questions per conversation. The PDF must be owned, available and ready. Client-supplied history is ignored.

1. Validate identity, input, document and chat. Acquire the existing document lease and recover any completed pending turn.
2. Replay an already-saved matching request ID without another generation or quota charge. A changed question with the same ID returns 409.
3. Under the MongoDB user lease, check quotas and insert one unique question reservation. Reservations count against capacity while retrieval is pending. SSE headers open only after this succeeds.
4. Mark the request started when Groq acknowledges the answer request with a successful HTTP response. Rewriting alone is not an answer start. A deterministic missing-information answer also marks the request started.
5. Save complete turns through the existing journal before SSE `done`. Release the distributed generation lease in `finally`.

Validation, ownership and quota failures are never charged. Retrieval failures, missing configuration, rejected provider requests or cancellation before answer generation starts release the daily/per-chat reservation. Once started, a question remains charged even if generation later fails, persistence fails or the client disconnects. Its concurrency lease is still released. Rate limiting includes admitted requests that later fail, while replaying a completed request does not consume another admission.

Both chat endpoints accept `{question, requestId?}`. Use the same stable 8–100 character letters/digits/underscore/hyphen ID when retrying the same logical question, including when switching JSON/SSE. The legacy endpoint accepts `{documentId, question, requestId?}` and caches completed results for idempotent replay. If omitted, the backend generates an ID: two separate requests without a shared ID are distinct questions. The current frontend sends no SSE request ID, so it should continue reloading history after an interrupted stream; it must not automatically resend an uncertain question.

A request already started but lacking a saved turn returns `409 REQUEST_ALREADY_ACCEPTED` on retry, rather than silently generating twice. If a journal exists, normal recovery can publish that completed turn first. Pre-generation failures can retry the same ID. A new ID intentionally starts a new question.

The UTC day is determined by admission time and resets at 00:00 UTC; the rolling minute is the preceding 60 seconds. `Retry-After` is returned for daily, per-minute and concurrency rejection. The daily reset is returned in error details and usage responses. Leases expire after the configured generation deadline plus 30 seconds if a process dies; heartbeats renew live reservations. Started attempts remain charged after lease expiry; abandoned reservations that never started stop consuming daily capacity.

Deleting documents or chats does not refund started questions. Today's committed legacy questions are copied to the minimal usage ledger before their messages are removed, preventing deletion from resetting the daily allowance. Saved questions and ledger entries are deduplicated when counting usage.

## API changes

All routes below require the existing session. Mutations retain origin and CSRF checks.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/usage` | New; returns `plan`, configured `limits`, `usage`, `remaining` and `dailyResetAt`; `Cache-Control: private, no-store` |
| `POST /api/documents/upload` | Validates bytes/pages; reserves PDF/storage capacity; deduplicates identical content |
| `GET /api/documents` | Lists available completed uploads with `expiresAt` |
| `GET /api/documents/:documentId` | Includes `expiresAt`; expired owned PDFs return 410 |
| `GET /api/documents/:documentId/file` and `/view` | Blocks expired/pending resources before private download |
| `POST /api/documents/:documentId/process` | Blocks expired resources; rechecks page/size limits before indexing |
| `DELETE /api/documents/:documentId` | Marks deletion pending and attempts complete cleanup; permits retry of expired/pending records |
| `POST /api/chats` | Enforces ten active account conversations, across PDFs; requires ready owned PDF |
| `GET /api/chats?documentId=...` | Lists available conversations with `expiresAt`; checks parent PDF |
| `GET /api/chats/:chatId/messages` | Blocks expired chat/PDF; retains pagination and journal recovery |
| `POST /api/chats/:chatId/messages` | Shared quota admission, JSON idempotency and completed-turn persistence |
| `POST /api/chats/:chatId/stream` | Shared quotas before headers; optional request ID; unchanged SSE event types |
| `DELETE /api/chats/:chatId` | New; deletes an owned conversation/messages under its parent lease, freeing a chat slot |
| `POST /api/rag/ask` | Retained; now supplies authenticated user ID, acquires the document lease and uses shared quotas |

`GET /api/usage` always scopes to the authenticated user; query-string `userId` values have no effect. Its `limits` also include per-minute and concurrency limits. Usage includes pending upload reservations and unexpired pending PDF deletion jobs. No filenames, provider credentials, object keys or another user's records are returned.

### Error contract

Quota errors use `{success:false,code,message,details}`. Other existing validation responses retain their current shapes. SSE quota errors normally use HTTP JSON before headers; late public errors include the code/details in the existing `error` event. There is no successful `done` for rejected generation.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 409 | `PDF_COUNT_LIMIT_REACHED` | No PDF slot available |
| 413 | `PDF_SIZE_LIMIT_EXCEEDED` | Actual byte count exceeds the configured per-file limit |
| 409 | `TOTAL_STORAGE_LIMIT_REACHED` | Uploaded bytes would exceed account storage |
| 413 | `PDF_PAGE_LIMIT_EXCEEDED` | Server-inspected page count exceeds the limit |
| 400 | `INVALID_PDF_FILE` | Missing, empty, malformed, unsupported, non-PDF or wrong MIME |
| 409 | `CHAT_LIMIT_REACHED` | No active conversation slot |
| 409 | `CHAT_QUESTION_LIMIT_REACHED` | Conversation question allowance exhausted |
| 429 | `DAILY_AI_LIMIT_REACHED` | Daily allowance exhausted; includes `limit`, `used`, UTC `resetAt` |
| 429 | `CHAT_RATE_LIMIT_REACHED` | Rolling minute exhausted; includes reset time |
| 429 | `GENERATION_ALREADY_RUNNING` | Distributed or existing process-local generation capacity exhausted |
| 410 | `DOCUMENT_EXPIRED` | Owned PDF retention elapsed |
| 410 | `CHAT_EXPIRED` | Owned conversation retention elapsed |
| 409 | `UPLOAD_IN_PROGRESS` | Same account/content already uploading |
| 409 | `REQUEST_ID_CONFLICT` / `REQUEST_ALREADY_ACCEPTED` | Conflicting request ID or an already-started attempt |
| 409 | `USAGE_BUSY` | Another quota update held the account lease for ten seconds; retry later |
| 503 | `USAGE_UNAVAILABLE` | Could not safely reserve usage or legacy sizes need verification |

Unowned IDs still return 404, including when the other user's resource is expired. Document-operation contention can retain its existing 409 busy response. The existing IP limiter can still return its own 429 response.

## MongoDB changes

No migration drops collections or changes authentication records. Startup initializes the new indexes using the existing model `init()` loop. Quota decisions use short, renewable MongoDB user leases; cloud requests execute outside that account lock. Document locks continue to serialize processing, answering and deletion. No replica-set transaction or paid service was added.

| Collection | Fields and indexes |
| --- | --- |
| `documents` | Adds `expiresAt`, `deletionPending`, `deletionAttempts`, `uploadState`, `uploadUntil`, `contentHash`. Adds `{userId,contentHash}`, `{expiresAt,deletionPending}` and `{deletionPending,uploadState,uploadUntil}` indexes. Existing ownership/activity indexes remain. The content hash index is non-unique; the account lease serializes deduplication and admissions. |
| `chats` | Adds `expiresAt` and `deletionPending`. Adds `{userId,expiresAt}` and `{expiresAt,deletionPending}` indexes. Existing per-document activity index remains. |
| `messages` | Adds `{userId,role,committed,createdAt}` to support daily legacy-question accounting without scanning other users' histories. Existing chat history and unique turn indexes remain. No new message fields or TTL. |
| `usage_accounts` | New; `_id` is the user's ID with MongoDB's unique `_id` index. `lockKey` and `lockUntil` coordinate account admissions across instances. `requestTimes` stores rolling-minute admissions, including retries of released IDs; old timestamps are pruned on the next admission. Timestamps record updates. No private document contents. |
| `question_usage` | New; owner/document/chat IDs, request ID/key, question hash, status, admission/reset timestamps, generation lease and retention timestamp. Unique `{userId,requestKey}`; additional `{userId,acceptedAt}`, `{userId,generationUntil}` and `{userId,chatId,status}` indexes. `result` is excluded by default and used only for legacy RAG replay; cleanup removes cached answers for deleted resources. |

`question_usage.expiresAt` has a TTL index. Entries live for the greater of PDF/chat retention (at admission), at least two days, plus one day. This keeps per-chat counts for its lifetime and today's counts after deletion. Only this self-contained accounting data uses TTL. PDFs, chats and messages have no new TTL indexes, because physical cleanup must include cloud stores. Runtime changes to retention do not rewrite existing expiry timestamps.

## Legacy rollout and backfill

Resources without `expiresAt` are temporarily treated as legacy/unexpired. Cleanup skips them. The API returns null for a legacy PDF expiry. Legacy data is not deleted just because this code is deployed. Do not announce a complete retention policy until the backfill is reviewed and applied.

1. Back up the database and deploy this code with all cloud environment values and limits. Review index initialization in startup logs.
2. Run tests against the isolated test database. Do not use live service diagnostics as a substitute.
3. Preview legacy expiry assignment:

   ```powershell
   npm run migrate:retention -- --dry-run
   ```

4. Review `wouldExpireNow` and `skippedWithoutTimestamp`. The backfill uses each record's original `createdAt` plus its retention interval. Old records can become unavailable immediately after applying. Missing creation timestamps are skipped for manual review; neither ObjectId age nor today's date is substituted.
5. Apply the reviewed backfill, then preview cleanup:

   ```powershell
   npm run migrate:retention -- --apply
   npm run cleanup:expired -- --dry-run
   ```

6. Once the deletion candidates are reviewed, run:

   ```powershell
   npm run cleanup:expired -- --apply
   ```

Backfill is idempotent: it only fills absent/null expiry fields, does not reset upload dates, and does not delete records. Both commands default to dry-run. They report aggregate counts without filenames or PDF contents. The cleanup command exits nonzero if any candidate fails, leaving it retryable.

Accounts already above the new limits keep their existing data and cannot add more until capacity is freed. Missing/invalid legacy PDF byte sizes cause a safe usage error; verify them against private storage and update metadata before accepting more uploads. Ownerless legacy data is excluded from user access and skipped by cloud cleanup for manual ownership review.

## Cleanup and scheduling

Physical deletion is a retryable sequence: set `deletionPending`, remove owner/document-filtered Qdrant vectors, remove the owner-prefixed Supabase object, preserve today's legacy usage, remove messages/chats, clear cached answer data and delete the PDF metadata last. A crash or provider failure leaves the pending record for the next run. An active document lease defers cleanup rather than racing indexing or generation. Expired-chat cleanup removes its messages and chat, preserving the PDF and vectors. A PDF's expiry removes all its child conversations even if their own retention date is later.

**Cleanup is not automatically scheduled by this implementation.** HTTP requests enforce resource expiry immediately, while objects and vectors may remain until a successful cleanup run. No cross-provider transaction or exact deletion deadline is promised. Provider outages, host downtime and database/network failures can delay physical removal. Repeated cleanup is safe.

Render Free services can spin down and cannot be assumed to run an in-process timer continuously. See [Render's free-service limits](https://render.com/docs/free). Run cleanup externally, for example through a scheduler on an existing trusted machine or an opted-in CI workflow. No public cleanup HTTP endpoint was added.

An optional GitHub Actions example is below. It is documentation only and is not installed or enabled. Check available Actions minutes, runner access to Atlas/cloud services, repository settings and the scheduler's logs before enabling it. Keep secrets in the repository/environment secret store and require `contents: read` only. Do not weaken Atlas network access just to make a runner connect.

```yaml
name: Expired DocMind data
on:
  workflow_dispatch:
  schedule:
    - cron: '17 2 * * *'
permissions:
  contents: read
concurrency:
  group: docmind-retention
  cancel-in-progress: false
jobs:
  cleanup:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      MONGO_URI: ${{ secrets.MONGO_URI }}
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}
      SUPABASE_BUCKET: ${{ secrets.SUPABASE_BUCKET }}
      QDRANT_URL: ${{ secrets.QDRANT_URL }}
      QDRANT_API_KEY: ${{ secrets.QDRANT_API_KEY }}
      QDRANT_COLLECTION: document_chunks_v2
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run cleanup:expired -- --apply
```

Scheduled Actions run from the default branch and may be delayed; public-repository schedules can be disabled after inactivity. See [GitHub's schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Verify a manual run, then a scheduled run and its failure notification path before describing physical retention as automatic. No scheduler, repository secrets or Render settings were changed here.

## Verification

```powershell
npm test
npm run test:usage
npm run test:latency
```

Tests use temporary MongoDB instances, real PDF fixtures, mocked Supabase/Qdrant, and a local HTTP server simulating Groq SSE. They do not read production PDFs or delete production objects. The quota suite covers exact byte/page/storage boundaries, simultaneous uploads and chats, last daily/per-chat slots, UTC rollover, shared JSON/SSE/RAG quotas, duplicate requests, cancellation, owner isolation, expired reads, partial-index deletion, failed uploads, cleanup retries and legacy backfill.

Production Atlas index creation, Supabase/Qdrant credentials and deletion behavior, Render deployment, actual provider latency and external scheduling are not verified by isolated tests. Perform a controlled staging check with dedicated non-production data before deployment. The optional browser fixture remains a separate development helper and is not part of the automated suite.

## Implementation files

New files for this feature:

- [config/usage-limits.js](../config/usage-limits.js)
- [modules/database/models/UsageAccount.js](../modules/database/models/UsageAccount.js) and [UsageAccount.README.md](../modules/database/models/UsageAccount.README.md)
- [modules/database/models/QuestionUsage.js](../modules/database/models/QuestionUsage.js) and [QuestionUsage.README.md](../modules/database/models/QuestionUsage.README.md)
- [modules/document/services/upload.service.js](../modules/document/services/upload.service.js)
- [modules/usage/index.js](../modules/usage/index.js), [README.md](../modules/usage/README.md), [errors.js](../modules/usage/errors.js), [resources.js](../modules/usage/resources.js), [lock.service.js](../modules/usage/lock.service.js), [usage.service.js](../modules/usage/usage.service.js), [cleanup.service.js](../modules/usage/cleanup.service.js)
- [scripts/cleanup-expired.js](../scripts/cleanup-expired.js) and [backfill-retention.js](../scripts/backfill-retention.js)
- [tests/usage-limits.test.js](../tests/usage-limits.test.js), [helpers/clouds.js](../tests/helpers/clouds.js), [helpers/pdf.js](../tests/helpers/pdf.js)
- This guide, [docs/FREE_PLAN.md](FREE_PLAN.md)

Updated files for this feature:

- [.env.example](../.env.example), [package.json](../package.json), [server.js](../server.js), [app.js](../app.js), [README.md](../README.md), [config/README.md](../config/README.md)
- [modules/index.js](../modules/index.js) and [modules/README.md](../modules/README.md)
- [middleware/upload.middleware.js](../middleware/upload.middleware.js), [document-operation.middleware.js](../middleware/document-operation.middleware.js), [README.md](../middleware/README.md)
- [modules/database/index.js](../modules/database/index.js), [README.md](../modules/database/README.md), [models/README.md](../modules/database/models/README.md), [Document.js](../modules/database/models/Document.js), [Document.README.md](../modules/database/models/Document.README.md), [Chat.js](../modules/database/models/Chat.js), [Chat.README.md](../modules/database/models/Chat.README.md), [Message.js](../modules/database/models/Message.js), [Message.README.md](../modules/database/models/Message.README.md)
- [modules/document/index.js](../modules/document/index.js), [controller/index.js](../modules/document/controller/index.js), [repository/index.js](../modules/document/repository/index.js), [services/pdf.service.js](../modules/document/services/pdf.service.js), [operation.service.js](../modules/document/services/operation.service.js), [README.md](../modules/document/README.md)
- [modules/chat/index.js](../modules/chat/index.js), [controller/index.js](../modules/chat/controller/index.js), [repository/index.js](../modules/chat/repository/index.js), [services/generation.service.js](../modules/chat/services/generation.service.js), [README.md](../modules/chat/README.md)
- [modules/rag/controller/index.js](../modules/rag/controller/index.js), [repository/index.js](../modules/rag/repository/index.js), [services/llm.service.js](../modules/rag/services/llm.service.js), [rag.service.js](../modules/rag/services/rag.service.js), [README.md](../modules/rag/README.md)
- [tests/multi-user.test.js](../tests/multi-user.test.js), [streaming.test.js](../tests/streaming.test.js), [README.md](../tests/README.md)
- [scripts/README.md](../scripts/README.md), [docs/README.md](README.md), [docs/STREAMING.md](STREAMING.md)

Changes already present before this task, including the toolbar and latency work, are preserved.
