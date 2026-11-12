# Message model

[Message.js](Message.js) defines the Mongoose `Message` model in the `messages` collection.

Stores one user question or assistant answer. The chat repository journals a completed turn, writes both messages and marks them committed before returning them in history. Assistant messages also retain the retrieved PDF passages.

| Field | Type / validation | Purpose |
| --- | --- | --- |
| `userId` | Required ObjectId, ref `User` | Owner scope |
| `documentId` | Required ObjectId, ref `Document` | Source PDF scope |
| `chatId` | Required ObjectId, ref `Chat` | Conversation scope |
| `role` | Required `user` or `assistant` | Speaker |
| `content` | Required string, max 20,000 | Question or answer text |
| `sources` | Array of Mixed objects, default empty | Evidence metadata such as page/chunk/content/distance |
| `requestId` | Required string | Groups a turn and supports JSON-endpoint retries |
| `committed` | Boolean, default false | Whether application history readers can show the record |

The model adds `_id` and timestamps. Indexes include `{chatId:1,createdAt:1,_id:1}` and `{chatId:1,committed:1,_id:-1}`. The latter matches committed-history queries and `_id` pagination, including the latest eight messages used as model memory. Unique `{chatId:1,requestId:1,role:1}` prevents a duplicate same-role message for the same request/turn.

The repository uses `bulkWrite` to upsert each message and `updateMany` to mark the turn committed. `getMessages` filters by user, document and chat, returning only committed records. Callers reverse its newest-first pages for display. The `sources` field accepts Mixed objects without validating their individual properties.

Example:

```javascript
const { Message } = require('../index');
const messages = await Message.find({ userId, documentId, chatId, committed: true })
  .sort({ _id: -1 }).limit(50).lean();
```

Only completed generation enters the journal/save path. Cancelled/failed generation does not create a partial assistant or orphan user message. The stream's preallocated assistant ID is used as this record's `_id` after success. There is no `status` field: SSE `status:'completed'` describes the protocol outcome; persisted visibility uses `committed`.

The index {userId:1,role:1,committed:1,createdAt:1} supports daily legacy-question accounting. Cleanup snapshots today's committed legacy requests into QuestionUsage before removing messages, so deletion cannot refund daily usage. See [free-plan accounting](../../../docs/FREE_PLAN.md).
