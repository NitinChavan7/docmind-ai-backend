// Shared incremental UTF-8 decoding for Ollama NDJSON and fetch-based SSE clients.
async function* textLines(body, { signal, maxLineLength = 131072, maxBytes = 4 * 1024 * 1024 } = {}) {
  if (!body?.getReader) throw new Error('Missing streaming response body');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', bytes = 0;
  const abort = () => { reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) { buffer += decoder.decode(); break; }
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Stream exceeded byte limit');
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        if (end > maxLineLength) throw new Error('Stream record exceeded length limit');
        yield buffer.slice(0, end).replace(/\r$/, '');
        buffer = buffer.slice(end + 1);
      }
      if (buffer.length > maxLineLength) throw new Error('Stream record exceeded length limit');
    }
    if (buffer.length > maxLineLength) throw new Error('Stream record exceeded length limit');
    if (buffer) yield buffer.replace(/\r$/, '');
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function* parseNdjson(body, options) {
  for await (const line of textLines(body, options)) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { throw new Error('Invalid Ollama JSON record'); }
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid Ollama record');
    yield record;
  }
}

// Useful for authenticated POST fetch consumers (including scripts/stream-chat.js).
async function* parseSse(body, options) {
  let event = 'message', data = [], length = 0;
  for await (const line of textLines(body, options)) {
    if (!line) {
      if (data.length) yield { event, data: JSON.parse(data.join('\n')) };
      event = 'message'; data = []; length = 0;
    } else if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) {
      const value = line.slice(5).replace(/^ /, '');
      length += value.length;
      if (length > 131072) throw new Error('SSE event exceeded length limit');
      data.push(value);
    }
    // Comments (heartbeats) and unsupported fields are deliberately ignored.
  }
  // An event without a final empty line is incomplete and is not dispatched.
}
module.exports = { textLines, parseNdjson, parseSse };
