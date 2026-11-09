# Document model

Source: [Document.js](Document.js). Library: `mongoose`. Model name: `Document`. Collection: `documents`.

This record describes an uploaded PDF and its owner. PDF bytes live on disk; searchable chunks/vectors live in Chroma. A document can have multiple chats.

| Field | Type / default | Purpose |
| --- | --- | --- |
| `userId` | Required indexed ObjectId, ref `User` | Owner checked in application queries |
| `originalName` | Required trimmed string | Filename shown to the user |
| `fileName` | Required string | Server-generated stored filename |
| `filePath` | Required string | Internal storage path; omitted from public metadata |
| `mimeType` | Required string | Uploaded MIME type |
| `fileSize` | Required number | Uploaded byte count |
| `status` | Enum; default `uploaded` | `uploaded`, `processing`, `extracted`, `ready`, `failed` |
| `pageCount` | Number, default 0 | Extracted PDF page count |
| `operationKey` | String, default null | UUID identifying a document operation lease |
| `operationUntil` | Date, default null | Lease expiry |

It also has `_id` and timestamps. Indexes: `userId` and `{userId:1,createdAt:-1}` for private newest-first libraries. Status is validated by the schema; required metadata does not itself validate PDF bytes. Multer and the document controller enforce upload size, MIME and `%PDF-` signature.

There are no custom model methods. Document repositories create/query/update/delete records; the operation service uses `findOneAndUpdate` and `updateOne` to acquire, renew and release leases. Normal indexing uses `uploaded -> processing -> ready` or `failed`; `extracted` is accepted but not used by the current active flow.

Internal read example:

```javascript
const { Document } = require('../index');
const document = await Document.findOne({ _id: documentId, userId }).lean();
```

The verified session supplies `userId`. Do not replace this filter with a bare `findById` in a public route. Deletion must coordinate file/vector/message/chat cleanup; Mongoose references do not perform that cleanup. Old documents without an owner are intentionally inaccessible through private user routes.
