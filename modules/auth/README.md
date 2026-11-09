# Authentication module

This module creates user accounts and signs users in with passwords or verified Google ID tokens. It issues the application's own HttpOnly JWT cookies and stores a revocable refresh session in MongoDB. It does not store JWTs in browser localStorage.

## Files and libraries

| File | Responsibility | Libraries/APIs |
| --- | --- | --- |
| [index.js](index.js) | Auth routes and sign-in attempt limiter | `express`, `express-rate-limit` |
| [controller/index.js](controller/index.js) | Registration, login, Google verification, profile, refresh, logout | `bcryptjs`, `google-auth-library`, Mongoose models |
| [services/token.service.js](services/token.service.js) | JWT creation/verification, refresh rotation and cookies | `jsonwebtoken`, `mongoose`, Node `crypto` |

`bcryptjs` hashes passwords using cost 12 and compares login passwords. `google-auth-library` checks a Google ID token for the configured client audience. `jsonwebtoken` signs/verifies HS256 application tokens. `crypto` creates unique JWT IDs and SHA-256 refresh-token hashes. See the [model guides](../database/models/README.md) for `User` and `AuthSession` fields.

## HTTP routes

| Method/path (under `/api/auth`) | Controller or handler | Purpose |
| --- | --- | --- |
| GET `/csrf` | `issueCsrf` middleware helper | Returns a CSRF token and seed cookie |
| GET `/config` | Inline router handler | Returns the public Google client ID or null |
| POST `/register` | `register(req,res,next)` | Creates a local user and session |
| POST `/login` | `login(req,res,next)` | Checks email/password and creates a session |
| POST `/google` | `googleLogin(req,res,next)` | Verifies `{credential}` and creates a session |
| POST `/refresh` | `refresh(req,res,next)` | Rotates the refresh cookie |
| GET `/me` | `me(req,res)` | Returns the signed-in user's public profile |
| POST `/logout` | `logout(req,res)` | Deletes the current session and clears cookies |

`/me` and `/logout` also require `requireAuth`. All POST routes require the existing origin/CSRF checks. Registration, login and Google login share a 20-attempt/15-minute per-IP limiter.

## Controller functions

`validEmail(email)` checks basic string format and the 254-character limit; it does not prove mailbox ownership. `publicUser(user)` returns only `id`, `name`, `email` and `provider`.

`register` trims the name, lowercases/trims email, validates name length and an 8-72-byte password, hashes it, saves a local user and sets cookies. The backend registration response already authenticates the user; a frontend can choose a separate sign-in experience afterward. Duplicate email returns 409.

`login` explicitly selects the normally hidden password hash and compares it. Unknown users also run a dummy password comparison. Invalid credentials return the same 401 message.

`googleLogin` verifies the ID token using `GOOGLE_CLIENT_ID`, requires a verified email, and uses Google's verified `sub` as `googleId`. It finds an existing Google identity or creates a new user. It returns 409 instead of silently linking a matching local email. Missing configuration returns 503; invalid credentials return 401.

`refresh` rotates the stored refresh hash and cookies; invalid/expired sessions return 401 and clear cookies. Unexpected database errors go to Express error handling. `me` returns the current profile. `logout` revokes the stored session, so its access JWT immediately fails future `requireAuth` checks.

## Token service functions

| Function | Input and result | Why it exists |
| --- | --- | --- |
| `signToken(userId,sessionId,type)` | Returns an access/refresh JWT | Signs identity/session claims with separate secrets and unique `jti` |
| `verifyToken(token,type,ignoreExpiration=false)` | Returns verified claims or throws | Checks signature, algorithm, issuer, audience, type and valid ObjectId claims |
| `tokenHash(token)` | Returns a SHA-256 hex digest | Stores a refresh token's fingerprint instead of the token |
| `createSession(userId,res)` | Creates MongoDB session; sets cookies | Starts a revocable login session |
| `rotateSession(token,res)` | Atomically changes hash; sets new cookies | Rejects old refresh tokens and revokes a session on known-token replay |
| `clearCookies(res)` | Clears both auth cookies | Ends browser authentication |
| `setCookies(res,access,refresh)` (internal) | Writes cookie headers | Centralizes cookie paths/lifetimes |

Access tokens last 15 minutes at cookie path `/api`; refresh tokens last seven days at `/api/auth`. Both are HttpOnly, SameSite=Lax, and Secure in production. `AuthSession.expiresAt` is checked in application code, not only by MongoDB TTL cleanup.

The CSRF helper is the only caller that deliberately verifies a signed token while ignoring its expiry, solely to bind a CSRF digest to a session ID. Authentication itself still checks expiration and the active MongoDB session.

## Usage and configuration

Fetch `GET /api/auth/csrf`, preserve cookies, then POST JSON with its `X-CSRF-Token`. Login body: `{"email":"person@example.com","password":"your-password"}`. Google body: `{"credential":"GOOGLE_ID_TOKEN"}`. Successful authentication returns `{success:true,data:{user:{id,name,email,provider}}}` and Set-Cookie headers. Obtain a fresh CSRF token after changing sessions.

Required secrets: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`. Optional issuer/audience defaults are `docmind-ai` and `docmind-ai-web`. Google needs `GOOGLE_CLIENT_ID`; its public value can be read by the frontend through `/config`. This flow does not use a frontend Google client secret. See [configuration](../../config/README.md) and the [Windows authentication commands](../../docs/STREAMING.md).

Email verification, password reset, secure account linking and device/session-management screens are not implemented by these functions.
