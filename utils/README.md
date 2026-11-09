# Streaming utilities

These helpers separate byte parsing and SSE formatting from business logic. They use Node/Web standard APIs and no third-party parsing library.

## Functions

| Source/function | Input | Output / behavior |
| --- | --- | --- |
| [stream.js](stream.js): `textLines(body,options={})` | Web ReadableStream of bytes; optional signal/limits | Async generator of decoded lines; handles split UTF-8 and CRLF |
| Same file: `parseNdjson(body,options)` | Ollama NDJSON byte stream | Async generator of parsed JSON objects; rejects malformed/non-object records |
| Same file: `parseSse(body,options)` | This API's SSE byte stream | Async generator of `{event,data}` with JSON-decoded data |
| [sse.js](sse.js): `openSse(res)` | Express response | Sets SSE/cache/proxy headers and flushes them |
| Same file: `sendSse(res,event,data,signal)` | Response, event name, JSON-safe data, optional signal | Writes one framed event and awaits drain on backpressure |

`TextDecoder` uses fatal UTF-8 validation and streaming decoding. `textLines` defaults to 4 MiB total bytes and 131,072 characters per line. Its abort listener cancels blocked reads; `finally` cancels/releases the reader. `parseNdjson` skips blank lines and permits a final record without a newline. LLM-specific completion/content checks live in `streamAnswer`, not in the generic parser.

`parseSse` recognizes `event:` and `data:` fields, joins multiple data lines, ignores heartbeat comments and dispatches only after a blank line. It bounds event data and drops an unfinished final event. It is intended for this JSON-data SSE contract, not as a complete EventSource replacement with automatic reconnect/retry support.

`sendSse` uses Node's `events.once` to await response `drain`. Event payloads are serialized with `JSON.stringify`, so content line breaks cannot accidentally create extra SSE frames.

## Usage

```javascript
const { parseSse } = require('./utils/stream'); // from the project root
for await (const { event, data } of parseSse(response.body, { signal })) {
  if (event === 'token') process.stdout.write(data.text);
}
```

The snippet belongs inside an async function and assumes an authenticated fetch response and caller AbortSignal. [scripts/stream-chat.js](../scripts/stream-chat.js) is a runnable example. The [streaming guide](../docs/STREAMING.md) defines terminal event/persistence behavior; reaching EOF alone does not mean an answer completed successfully.
