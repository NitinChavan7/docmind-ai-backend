# Document model

[Document.js](Document.js) defines the Mongoose `Document` model in the `documents` collection.

This record describes an uploaded PDF and its owner. PDF bytes live in private Supabase Storage; searchable chunks and vectors live in Qdrant. A document can have multiple chats.

| Field | Type / default | Purpose |
| --- | --- | --- |
| `userId` | Required indexed ObjectId, ref `User` | Owner checked in application queries |
| `originalName` | Required trimmed string | Filename shown to the user |
| `fileName` | Required string | Server-generated UUID filename used in the object key |
| `filePath` | Required string | Supabase object key `<userId>/<generated-filename>`; omitted from public metadata |
| `mimeType` | Required string | Uploaded MIME type |
| `fileSize` | Required number | Uploaded byte count |
| `status` | Enum; default `uploaded` | `uploaded`, `processing`, `extracted`, `ready`, `failed` |
| `pageCount` | Number, default 0 | Extracted PDF page count |
| `operationKey` | String, default null | UUID identifying a document operation lease |
| `operationUntil` | Date, default null | Lease expiry |
| `expiresAt` | UTC Date; upload plus configured retention | Expired PDFs are unavailable even before cleanup |
| `deletionPending` | Boolean, default false | Durable retryable deletion marker |
| `deletionAttempts` | Number, default 0 | Physical cleanup attempts |
| `uploadState` | `pending` or `complete`; default complete | Pending metadata reserves count/bytes and is hidden from reads |
| `uploadUntil` | UTC Date or null | Abandoned pending-upload cleanup deadline |
| `contentHash` | Optional string | SHA-256 of server-read bytes for account-scoped retry deduplication |

It also has `_id` and timestamps. Indexes: `userId` and `{userId:1,createdAt:-1}` for private newest-first libraries. Status is validated by the schema; required metadata does not itself validate PDF bytes. Multer and the upload service enforce actual bytes, MIME, signature and parser-inspected page count before Supabase upload. Additional indexes cover `{userId,contentHash}`, `{expiresAt,deletionPending}` and `{deletionPending,uploadState,uploadUntil}`. No PDF TTL index is used.

The document repository creates, reads, updates and deletes these records. The operation service uses `findOneAndUpdate` and `updateOne` to acquire, renew and release leases. Normal indexing follows `uploaded -> processing -> ready`; a failure after processing begins sets `failed`. The schema also accepts `extracted`, though the current controller does not set it.

Legacy records without expiry remain available until a reviewed backfill assigns it. Pending deletion retains unexpired capacity until cleanup finishes. See [retention and migration](../../../docs/FREE_PLAN.md).

Internal read example:

```javascript
const { Document } = require('../index');
const document = await Document.findOne({ _id: documentId, userId }).lean();
```

The verified session supplies `userId`. Do not replace this filter with a bare `findById` in a public route. Deletion must coordinate Supabase object, Qdrant vector, message and chat cleanup; Mongoose references do not perform that cleanup. Old documents without an owner are inaccessible through private user routes. Documents with old local file paths also need reuploading because preview and processing require an owner-prefixed Supabase key.
