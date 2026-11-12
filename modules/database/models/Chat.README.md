# Chat model

[Chat.js](Chat.js) defines the Mongoose `Chat` model in the `chats` collection.

Groups messages into a conversation about one owned PDF. A document can have several chats, each with its own title and saved history.

| Field | Type / default | Purpose |
| --- | --- | --- |
| `userId` | Required ObjectId, ref `User` | Conversation owner |
| `documentId` | Required ObjectId, ref `Document` | PDF used for grounding |
| `title` | String, default `New conversation`, max 120 | Conversation selector label |
| `lastMessageAt` | Date, default now | Activity ordering |
| `pendingTurn` | Mixed, default null, excluded from normal selections | Internal completed-answer journal for recoverable persistence |
| `expiresAt` | UTC Date; creation plus configured retention | Blocks expired conversations before cleanup |
| `deletionPending` | Boolean, default false | Hides conversations while message cleanup is pending |

There are also `_id` and timestamps. The compound index is `{userId:1,documentId:1,lastMessageAt:-1}`. Additional indexes cover `{userId:1,expiresAt:1}` and `{expiresAt:1,deletionPending:1}`. No chat TTL index is used. Multiple chats for the same document are permitted; no uniqueness constraint forces a single conversation.

The chat repository creates, lists and looks up conversations. `getOwnedChat` selects `+pendingTurn` for recovery. `saveTurn` stores `{requestId,question,result,messageIds?}` there; `recoverTurn` writes both messages, updates activity and clears the journal. If the title is still `New conversation`, it becomes the first 100 characters of the question.

Example:

```javascript
const { Chat } = require('../index');
const chats = await Chat.find({ userId, documentId }).sort({ lastMessageAt: -1 }).lean();
```

`pendingTurn` contains only a fully generated answer, not incoming token fragments. It is an internal persistence mechanism, not a user-visible draft. Reading a chat does not itself prove that its referenced document still exists or has the same owner; the controller checks both. Journal recovery and writes must run under the document lease.
