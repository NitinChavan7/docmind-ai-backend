const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseNdjson, parseSse } = require('../utils/stream');
const { openSse, sendSse } = require('../utils/sse');
const { EventEmitter } = require('events');
const bytes = text => {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) {
    // Split inside every multibyte character and JSON escape sequence.
    for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
};
const collect = async iterator => { const values = []; for await (const value of iterator) values.push(value); return values; };

test('Ollama NDJSON survives split UTF-8, CRLF, blank lines and final line without newline', async () => {
  const records = await collect(parseNdjson(bytes('\r\n{"message":{"content":"नमस्ते 🌍"},"done":false}\r\n{"done":true}')));
  assert.equal(records[0].message.content, 'नमस्ते 🌍');
  assert.equal(records[1].done, true);
});
test('malformed/oversized NDJSON and invalid UTF-8 fail explicitly', async () => {
  await assert.rejects(collect(parseNdjson(bytes('{broken}\n'))), /Invalid Ollama JSON/);
  await assert.rejects(collect(parseNdjson(bytes('[]\n'))), /Invalid Ollama record/);
  await assert.rejects(collect(parseNdjson(bytes('{"long":"value"}'), { maxLineLength: 4 })), /length limit/);
  await assert.rejects(collect(parseNdjson(bytes('{}\n{}\n'), { maxBytes: 2 })), /byte limit/);
  const invalidUtf8 = new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(255)); c.close(); } });
  await assert.rejects(collect(parseNdjson(invalidUtf8)), /encoded data|encoding/i);
});
test('SSE parser yields status, meta, deltas and done exactly once, ignoring heartbeat comments', async () => {
  const events = await collect(parseSse(bytes(': keep-alive\r\n\r\nevent: status\r\ndata: {"stage":"generating"}\r\n\r\nevent: meta\ndata: {"sources":[]}\n\nevent: token\ndata: {"text":"🌍\\nhello"}\n\nevent: done\ndata: {"status":"completed"}\n\n')));
  assert.deepEqual(events.map(item => item.event), ['status', 'meta', 'token', 'done']);
  assert.equal(events[2].data.text, '🌍\nhello');
  assert.deepEqual(await collect(parseSse(bytes('event: done\ndata: {"status":"completed"}\n'))), []);
  await assert.rejects(collect(parseSse(bytes('event: token\ndata: nope\n\n'))), SyntaxError);
});
test('abort interrupts a blocked reader, cancels the upstream body and releases its lock', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const controller = new AbortController();
  const pending = collect(parseNdjson(body, { signal: controller.signal }));
  controller.abort(new Error('Cancelled by test'));
  await assert.rejects(pending, /Cancelled by test/);
  assert(cancelled);
  assert.equal(body.locked, false);
});
test('SSE writer formats safely and waits for downstream backpressure', async () => {
  const response = new EventEmitter();
  let written, flushed = false;
  response.status = () => response;
  response.set = headers => { assert.equal(headers['X-Accel-Buffering'], 'no'); return response; };
  response.flushHeaders = () => { flushed = true; };
  response.write = text => { written = text; return false; };
  openSse(response);
  assert(flushed);
  let sent = false;
  const pending = sendSse(response, 'token', { text: 'line\n\n🌍' }).then(() => { sent = true; });
  await Promise.resolve();
  assert.equal(sent, false);
  response.emit('drain');
  await pending;
  assert.equal(written, 'event: token\ndata: {"text":"line\\n\\n🌍"}\n\n');
});
