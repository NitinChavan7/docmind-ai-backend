# Chat model

Source: [Chat.js](Chat.js). Library: `mongoose`. Model name: `Chat`. Collection: `chats`.

This record represents one conversation about one owned PDF. Switching candidates selects different document IDs and therefore different chat lists.

| Field | Type / default | Purpose |
| --- | --- | --- |
| `userId` | Required ObjectId, ref `User` | Conversation owner |
| `documentId` | Required ObjectId, ref `Document` | PDF used for grounding |
| `title` | String, default `New conversation`, max 120 | Conversation selector label |
| `lastMessageAt` | Date, default now | Activity ordering |
| `pendingTurn` | Mixed, default null, excluded from normal selections | Internal completed-answer journal for recoverable persistence |

There are also `_id` and timestamps. The compound index is `{userId:1,documentId:1,lastMessageAt:-1}`. Multiple chats for the same document are permitted; no uniqueness constraint forces a single conversation.

There are no schema-defined functions. The chat repository provides create/list/lookup operations. `getOwnedChat` explicitly selects `+pendingTurn` for recovery. `saveTurn` puts `{requestId,question,result,messageIds?}` in that field; `recoverTurn` writes both messages, updates activity/title and clears the journal. If the title is still `New conversation`, it uses the first question's first 100 characters.

Example:

```javascript
const { Chat } = require('../index');
const chats = await Chat.find({ userId, documentId }).sort({ lastMessageAt: -1 }).lean();
```

`pendingTurn` contains only a fully generated answer, not incoming token fragments. It is an internal persistence mechanism, not a user-visible draft. Reading a chat does not itself prove that its referenced document still exists or has the same owner; the controller checks both. Journal recovery and writes must run under the document lease.
