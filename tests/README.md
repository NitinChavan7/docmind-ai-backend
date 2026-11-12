# Backend tests

Run the full automated suite:

```powershell
npm test
```

The suite uses Node's test runner, Supertest and temporary MongoDB instances. First use may download a MongoDB binary. Supabase and Qdrant are mocked before application imports; streaming uses a local HTTP server that emits Groq-compatible SSE. No production credentials or objects are required.

| File | Coverage |
| --- | --- |
| [multi-user.test.js](multi-user.test.js) | Accounts, password/Google login, cookies, CSRF, ownership, histories, retries, journal recovery and logout |
| [streaming.test.js](streaming.test.js) | Real Groq-adapter SSE parsing against a local fake provider, event ordering, persistence, cancellation, deadlines and process capacity |
| [stream-parser.test.js](stream-parser.test.js) | Shared UTF-8, NDJSON/SSE parsing, cancellation and backpressure |
| [llm-latency.test.js](llm-latency.test.js) | Standalone-call reduction, contextual rewriting, deadlines and reasoning settings |
| [chat-latency.test.js](chat-latency.test.js) | Authentication query concurrency, ownership, idempotency, turn persistence and stream errors |
| [usage-limits.test.js](usage-limits.test.js) | Quota boundaries/races, UTC reset, distributed leases, shared endpoint quotas, retention, cleanup retries and backfill |
| [helpers/clouds.js](helpers/clouds.js) | In-memory private object storage/vector mocks with injectable failures |
| [helpers/pdf.js](helpers/pdf.js) | Real PDF fixtures with configurable pages and exact byte sizes |

Focused commands:

```powershell
npm run test:usage
npm run test:latency
node --test tests/stream-parser.test.js
```

Expected result: all selected tests pass with zero failures. Test rate-limit overrides in the legacy protocol suite allow it to exercise many failure cases; the usage suite verifies the actual free-plan defaults. See [the free-plan guide](../docs/FREE_PLAN.md) for the rollout checklist, schema/index changes and complete quota test scenarios.

## Verification limits

Mocks verify application behavior, not real provider credentials, cloud availability, production indexes or deployment. Live [manual diagnostics](../scripts/README.md) are separate and make external requests. No retention scheduler is configured by these tests.

[browser-server.js](browser-server.js) is an older standalone browser fixture, outside npm test. It still needs migration of its Supabase handling and cleanup before use. Do not use it as a production server or as proof of cloud integration coverage.
