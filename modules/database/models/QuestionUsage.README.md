# QuestionUsage model

[QuestionUsage.js](QuestionUsage.js) stores durable question admissions in `question_usage` for chat JSON, SSE and legacy RAG.

| Field | Meaning |
| --- | --- |
| `userId`, `documentId`, `chatId` | Owner/PDF scope; chat is null for legacy RAG |
| `requestId`, `requestKey` | Client/server request ID and scope-qualified idempotency key |
| `questionHash` | SHA-256 of the document ID and question; detects conflicting reuse without storing raw question text |
| `status` | `reserved`, `started`, `completed`, `failed` or `released` |
| `acceptedAt`, `dailyResetAt` | UTC admission timestamp and next daily boundary |
| `generationKey`, `generationUntil` | Renewable generation lease; null deadline after completion/release |
| `resourceDeleted` | Referenced data has been removed; accounting remains until expiry |
| `result` | Normally unselected Mixed result for completed legacy RAG replay; removed during resource cleanup |
| `expiresAt` | Accounting retention deadline |

`started`, `completed` and `failed` entries consume accepted-question quotas. A live `reserved` entry holds capacity until generation begins or admission is released. Expired reservations that never started no longer consume daily/per-chat capacity. The minute limiter separately stores each admission in `UsageAccount.requestTimes`, including retries after a pre-generation failure.

Indexes: unique `{userId:1,requestKey:1}`, `{userId:1,acceptedAt:1}`, `{userId:1,generationUntil:1}`, `{userId:1,chatId:1,status:1}`, and TTL `{expiresAt:1}`. Accounting outlives the configured PDF/chat retention by one day, with at least three days total. TTL is safe here because this collection owns no cloud objects. PDF/chat deletion never depends on TTL and never refunds today's started questions.

See [charge and retry semantics](../../../docs/FREE_PLAN.md).
