# Manual scripts and diagnostics

These scripts help a developer inspect connectivity or consume the streaming API. They are not extra Express routes and are not run by normal server startup.

## Streaming CLI

Source: [stream-chat.js](stream-chat.js). Dependencies: Node 20 `fetch`, `AbortController`, `AbortSignal`, `process` and [parseSse](../utils/stream.js); no additional npm package.

The script reads chat ID/question from command-line arguments and cookies/CSRF from environment variables. Its `cancel()` callback aborts fetch on Ctrl+C. Its async entry function POSTs the question, parses events, prints progress to stderr and text deltas to stdout, and requires a successful `done` before reporting the answer saved. Errors set exit code 1; user cancellation uses 130. Cleanup aborts the controller and removes the SIGINT listener. It has a 210-second client HTTP timeout.

| Variable | Purpose |
| --- | --- |
| `DOCMIND_COOKIE` | Current authenticated chat-URL cookie header |
| `DOCMIND_CSRF` | Matching session's issued CSRF token |
| `DOCMIND_API_URL` | Optional API base, default `http://localhost:5000/api` |

```powershell
# First log in and obtain cookies/CSRF as shown in the streaming guide.
node scripts/stream-chat.js YOUR_CHAT_ID 'What skills are listed?'
```

See [the complete Windows setup](../docs/STREAMING.md) for working authentication/export commands, cancellation and history verification. The CLI does not automatically refresh expired credentials or retry partially received answers.

## Root diagnostic scripts

| Source/function | What it does | Requirements |
| --- | --- | --- |
| [testChroma.js](../testChroma.js): `testChroma()` | Gets/creates the configured collection and prints its name/vector count | `dotenv`, vector service, running Chroma |
| [testEmbedding.js](../testEmbedding.js): `testEmbedding()` | Embeds two sample strings; prints count, dimension and first five values | `dotenv`, embedding service, running Ollama/model |
| [testSearch.js](../testSearch.js): `testSearch()` | Embeds a sample question and searches the hard-coded document ID | `dotenv`, embedding/vector services, previously indexed PDF |

Run from the project root using `node testEmbedding.js`, `node testChroma.js` or `node testSearch.js`. These are manual connectivity checks, not the `npm test` assertion suite. They catch/log failures and do not provide the same pass/fail guarantees as automated tests.

`testSearch.js` contains a specific development document ID; it is not portable test data. It also prints matching chunk contents. Use it only for data you are allowed to inspect and keep such output private. Direct vector service calls bypass the ownership boundary provided by normal authenticated HTTP controllers.
