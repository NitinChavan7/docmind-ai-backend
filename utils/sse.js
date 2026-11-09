const { once } = require('events');
const openSse = res => {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
};
const sendSse = async (res, event, data, signal) => {
  signal?.throwIfAborted();
  if (res.destroyed || res.writableEnded) throw new Error('Response closed');
  if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) {
    await once(res, 'drain', { signal });
  }
};
module.exports = { openSse, sendSse };
