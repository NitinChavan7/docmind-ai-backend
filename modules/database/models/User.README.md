# User model

Source: [User.js](User.js). Library: `mongoose`. Model name: `User`. Collection: `users`.

This record identifies an account. It is used by registration/login, Google identity lookup, profile responses and active-user checks in authentication middleware.

| Field | Type / validation | Purpose |
| --- | --- | --- |
| `name` | Required trimmed string, max 100 | Display name |
| `email` | Required trimmed/lowercase string, max 254 | Account lookup; uniquely indexed |
| `passwordHash` | String, excluded from normal selections | bcrypt hash for local login; never plaintext |
| `googleId` | String, default null | Google's verified `sub` identity |
| `provider` | Required `local` or `google` | Sign-in provider at account creation |
| `emailVerified` | Boolean, default false | True for a verified Google sign-in; local email verification is not implemented |

Mongoose also adds `_id`, timestamps and its normal version field. Indexes enforce unique email and unique Google ID for records whose Google ID is a string (partial index). Missing/null Google IDs do not need to be unique.

There are no model-defined functions. The auth controller calls `User.create`, `findOne`, `findById` and `exists`. For password login it explicitly uses `.select('+passwordHash')`; its public profile helper returns only ID, name, email and provider. `select:false` is a query default, not encryption or an authorization rule.

Internal lookup example:

```javascript
const { User } = require('../index'); // when called from this models directory
const account = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
```

The controller performs email/password validation and hashing; the schema does not conditionally require a password hash for local users. Google users have no local password hash. A matching email does not automatically link providers. Related records point to this `_id`, but deleting a User does not automatically cascade sessions/documents/chats/messages.
