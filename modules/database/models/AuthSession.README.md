# AuthSession model

[AuthSession.js](AuthSession.js) defines the Mongoose `AuthSession` model in the `auth_sessions` collection.

Stores the revocable session behind the authentication cookies. Authentication checks both the JWT and this record, including its expiry.

| Field | Type / validation | Purpose |
| --- | --- | --- |
| `userId` | Required ObjectId referencing `User`; indexed | Session owner |
| `tokenHash` | Required unique string | SHA-256 hash of the current refresh JWT |
| `usedTokenHashes` | String array, default empty | Previously rotated refresh hashes for replay detection |
| `expiresAt` | Required Date | Application session expiry and TTL cleanup |

The model adds `_id` and timestamps. The session `_id` becomes the signed JWT's `sid`. A unique index covers `tokenHash`; a TTL index on `expiresAt` uses `expireAfterSeconds:0`. TTL deletion can be delayed, so query filters also require `expiresAt > now`.

The token service creates sessions with `createSession`. On refresh, `rotateSession` atomically replaces the current hash and adds the old hash to `usedTokenHashes`. Reusing a previously accepted refresh token deletes the session. `requireAuth` checks the owner and expiry; logout deletes the current session too.

Internal check example:

```javascript
const { AuthSession } = require('../index');
const session = await AuthSession.findOne({
  _id: sessionId, userId, expiresAt: { $gt: new Date() },
}).lean();
```

Raw refresh JWTs are not stored here. Refresh rotation extends expiry by seven days. Deleting the record immediately invalidates future authenticated requests using that session, even when the access JWT's signature/expiry is otherwise valid. Open streaming requests are authenticated at admission; clients should abort them on logout.
