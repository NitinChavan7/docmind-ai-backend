# UsageAccount model

[UsageAccount.js](UsageAccount.js) stores one quota mutex per account in `usage_accounts`.

| Field | Meaning |
| --- | --- |
| `_id` | User ObjectId; MongoDB's unique primary-key index serializes account lock acquisition |
| `lockKey` | Random identifier for the current quota decision, or null |
| `lockUntil` | UTC lease deadline, or null |
| `requestTimes` | Dates of recent generation admissions; pruned to the rolling minute on the next admission |
| `createdAt`, `updatedAt` | Mongoose timestamps |

`withUserLock` acquires this record atomically, renews it every ten seconds and releases only its matching key. The lease lasts 30 seconds. Contenders wait up to ten seconds; an unavailable database or lost lease fails admission. Provider calls happen outside this short lock. The record stores no document contents or provider secrets and has no TTL index.

Daily and concurrency usage live in [QuestionUsage](QuestionUsage.README.md); PDF/chat capacity is derived from resource records. See [usage and retention](../../../docs/FREE_PLAN.md).
