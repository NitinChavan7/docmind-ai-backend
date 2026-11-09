// Node 20 POST-fetch consumer for manually verifying the streaming API.
const { parseSse } = require('../utils/stream');
const [chatId, question] = process.argv.slice(2);
if (!chatId || !question || !process.env.DOCMIND_COOKIE || !process.env.DOCMIND_CSRF) {
  console.error('Usage: set DOCMIND_COOKIE and DOCMIND_CSRF, then node scripts/stream-chat.js CHAT_ID "Your question"');
  process.exit(1);
}
const controller = new AbortController();
const cancel = () => controller.abort();
process.once('SIGINT', cancel);
(async () => {
  const base = (process.env.DOCMIND_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');
  const response = await fetch(`${base}/chats/${encodeURIComponent(chatId)}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: process.env.DOCMIND_COOKIE, 'X-CSRF-Token': process.env.DOCMIND_CSRF },
    body: JSON.stringify({ question }),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(210000)]),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${response.status})`);
  }
  let completed = false;
  for await (const { event, data } of parseSse(response.body, { signal: controller.signal })) {
    if (event === 'status') process.stderr.write(`[${data.stage}]\n`);
    if (event === 'token') process.stdout.write(data.text);
    if (event === 'error') throw new Error(data.message);
    if (event === 'cancelled') { controller.abort(); break; }
    if (event === 'done') { completed = true; process.stdout.write(`\n[Saved message ${data.messageId}]\n`); }
  }
  if (!completed && !controller.signal.aborted) throw new Error('The connection ended before the answer was confirmed. Check saved chat history before retrying.');
})().catch(error => {
  console.error(controller.signal.aborted ? '\nAnswer stopped.' : `\n${error.message}`);
  process.exitCode = controller.signal.aborted ? 130 : 1;
}).finally(() => { controller.abort(); process.removeListener('SIGINT', cancel); });
