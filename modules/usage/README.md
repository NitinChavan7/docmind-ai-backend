# Usage and retention

`GET /api/usage` returns the signed-in account's limits, capacity, daily questions and next UTC reset. Parent middleware supplies authentication and CSRF for protected routes.

| File | Responsibility |
| --- | --- |
| [usage.service.js](usage.service.js) | Account capacity, upload reservations, chat creation and question admission |
| [lock.service.js](lock.service.js) | Renewable per-user MongoDB lease for short quota decisions |
| [resources.js](resources.js) | Availability/expiry checks and UTC day boundaries |
| [errors.js](errors.js) | Public machine-readable quota errors and Retry-After |
| [cleanup.service.js](cleanup.service.js) | Retryable PDF/chat deletion and expired-data cleanup |

Uploads reserve capacity through pending document metadata. Questions reserve through a unique `QuestionUsage` record before SSE headers or model work. Live requests release generation leases in `finally`; crashed-process leases expire. Started questions remain counted after resource deletion.

See [the free-plan guide](../../docs/FREE_PLAN.md) for exact charge semantics, environment variables, statuses, schema/index changes, backfill, cleanup commands, scheduler requirements, test coverage and the complete file inventory. Physical cleanup is not automatically scheduled.
