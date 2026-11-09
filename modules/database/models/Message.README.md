# Message model

Source: [Message.js](Message.js). Library: `mongoose`. Model name: `Message`. Collection: `messages`.

This record stores one side of a conversation turn. A successful answer normally creates two records: the user's question and the assistant's answer with PDF sources.

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

The model adds `_id` and timestamps. Index `{chatId:1,createdAt:1,_id:1}` supports ordered history. Unique `{chatId:1,requestId:1,role:1}` prevents a duplicate same-role message for the same request/turn.

There are no custom model functions. The repository uses `bulkWrite` upserts, `updateMany`, queries and deletion. `getMessages` scopes by user/document/chat and returns only committed records; callers reverse its newest-first pages for display. Sources are flexible Mixed objects, so the schema does not deeply validate their shape.

Example:

```javascript
const { Message } = require('../index');
const messages = await Message.find({ userId, documentId, chatId, committed: true })
  .sort({ _id: -1 }).limit(50).lean();
```

Only completed generation enters the journal/save path. Cancelled/failed generation does not create a partial assistant or orphan user message. The stream's preallocated assistant ID is used as this record's `_id` after success. There is no `status` field: SSE `status:'completed'` describes the protocol outcome; persisted visibility uses `committed`.
