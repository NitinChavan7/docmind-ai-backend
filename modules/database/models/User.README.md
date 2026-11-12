# User model

[User.js](User.js) defines the Mongoose `User` model in the `users` collection.

Stores account identity for password or Google sign-in. Authentication controllers create and look up these records; middleware checks that the account still exists.

| Field | Type / validation | Purpose |
| --- | --- | --- |
| `name` | Required trimmed string, max 100 | Display name |
| `email` | Required trimmed/lowercase string, max 254 | Account lookup; uniquely indexed |
| `passwordHash` | String, excluded from normal selections | bcrypt hash for local login; never plaintext |
| `googleId` | String, default null | Google's verified `sub` identity |
| `provider` | Required `local` or `google` | Sign-in provider at account creation |
| `emailVerified` | Boolean, default false | True for a verified Google sign-in; local email verification is not implemented |

Mongoose also adds `_id`, timestamps and its normal version field. Indexes enforce unique email and unique Google ID for records whose Google ID is a string (partial index). Missing/null Google IDs do not need to be unique.

The auth controller uses Mongoose methods to create accounts and look up identities. Password login explicitly selects `.select('+passwordHash')`; the public profile contains only `id`, `name`, `email` and `provider`. Other queries leave the hash out by default.

Internal lookup example:

```javascript
const { User } = require('../index'); // when called from this models directory
const account = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
```

The controller performs email/password validation and hashing; the schema does not conditionally require a password hash for local users. Google users have no local password hash. A matching email does not automatically link providers. Related records point to this `_id`, but deleting a User does not automatically cascade sessions/documents/chats/messages.
