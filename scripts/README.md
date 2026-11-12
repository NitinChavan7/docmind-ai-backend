# Manual scripts and diagnostics

Run scripts from the backend root with your local `.env` configured. They are separate from `npm test` and normal server startup.

## Cloud checks

| Script | What it does |
| --- | --- |
| [test-groq.js](../test-groq.js) | Calls Groq with sample context, first as a full response and then as a stream |
| [test-qdrant.js](../test-qdrant.js) | Lists collections to check connectivity |
| [test-qdrant-inference.js](../test-qdrant-inference.js) | Inserts one sample inference point, searches and attempts cleanup of that point |
| [test-qdrant-delete.js](../test-qdrant-delete.js) | Creates unique diagnostic user/document filter values, verifies zero matches and tests filtered deletion |
| [test-supabase.js](../test-supabase.js) | Reads the configured bucket and prints its name/public status |

For example: `node test-groq.js` or `node test-qdrant.js`. These commands make live service requests. The inference diagnostic hard-codes `document_chunks_v2` and the default MiniLM model; check those values against your environment first. None of these scripts establishes full application behavior or answer quality.

## Streaming client

[stream-chat.js](stream-chat.js) consumes the authenticated chat SSE API with Node fetch and [parseSse](../utils/stream.js). Set `DOCMIND_COOKIE` and `DOCMIND_CSRF` from a current session. `DOCMIND_API_URL` defaults to `http://localhost:5000/api`.

```powershell
node scripts/stream-chat.js YOUR_CHAT_ID 'What skills are listed?'
```

The client prints stages to stderr and answer deltas to stdout. It requires a successful `done` event, aborts on Ctrl+C and has a 210-second client timeout. It does not refresh expired credentials or retry interrupted generations. See [streaming commands](../docs/STREAMING.md) for login, cookie export and history checks.

## Older helpers

`setup-qdrant.js` currently creates 768-dimensional vectors and defaults to `document_chunks`, while the active MiniLM integration uses a compatible 384-dimensional collection and defaults to `document_chunks_v2`. Do not use it as the current collection setup without updating it.

`testEmbedding.js` and `testSearch.js` import the removed `generateEmbeddings` function. `testSearch.js` also has an old hard-coded document ID and does not supply the authenticated user required by current vector search. `testChroma.js` calls the current Qdrant collection reader but then expects Chroma's collection/count interface. These helpers need migration before use; the cloud checks above match the active service APIs.

## Free-plan quotas and retention

See [the free-plan guide](../docs/FREE_PLAN.md) for backend limits, explicit expiry, retryable cleanup, migration commands and scheduler requirements. Uploads are parser-inspected before private storage; quota decisions are persisted in MongoDB. Physical cleanup requires an external scheduler and is not automatically enabled.
