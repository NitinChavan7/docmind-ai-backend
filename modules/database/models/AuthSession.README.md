# AuthSession model

Source: [AuthSession.js](AuthSession.js). Library: `mongoose`. Model name: `AuthSession`. Collection: `auth_sessions`.

This record makes JWT login sessions revocable. A valid JWT alone is insufficient: authentication also checks that its session exists and has not expired.

| Field | Type / validation | Purpose |
| --- | --- | --- |
| `userId` | Required ObjectId referencing `User`; indexed | Session owner |
| `tokenHash` | Required unique string | SHA-256 hash of the current refresh JWT |
| `usedTokenHashes` | String array, default empty | Previously rotated refresh hashes for replay detection |
| `expiresAt` | Required Date | Application session expiry and TTL cleanup |

The model adds `_id` and timestamps. The session `_id` becomes the signed JWT's `sid`. A unique index covers `tokenHash`; a TTL index on `expiresAt` uses `expireAfterSeconds:0`. TTL deletion can be delayed, so query filters also require `expiresAt > now`.

There are no custom model functions. `createSession` creates the record; `rotateSession` atomically compares/replaces the current hash and remembers its old hash; known old-token reuse revokes the session family. `requireAuth` checks owner/expiry, and logout deletes the current session.

Internal check example:

```javascript
const { AuthSession } = require('../index');
const session = await AuthSession.findOne({
  _id: sessionId, userId, expiresAt: { $gt: new Date() },
}).lean();
```

Raw refresh JWTs are not stored here. Refresh rotation extends expiry by seven days. Deleting the record immediately invalidates future authenticated requests using that session, even when the access JWT's signature/expiry is otherwise valid. Open streaming requests are authenticated at admission; clients should abort them on logout.
