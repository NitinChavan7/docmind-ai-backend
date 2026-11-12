const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rewriteQuestion, generateAnswer } = require('../modules/rag/services/llm.service');

const history = [
  { role: 'user', content: 'What technologies does the candidate know?' },
  { role: 'assistant', content: 'React and Node.js.' },
];
const completion = content => Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
const setup = t => {
  const oldKey = process.env.GROQ_API_KEY;
  const oldEffort = process.env.GROQ_REASONING_EFFORT;
  process.env.GROQ_API_KEY = 'test-key';
  delete process.env.GROQ_REASONING_EFFORT;
  t.after(() => {
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
    if (oldEffort === undefined) delete process.env.GROQ_REASONING_EFFORT;
    else process.env.GROQ_REASONING_EFFORT = oldEffort;
  });
};

test('standalone questions with history reach the answer with only one Groq call', async t => {
  setup(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(JSON.parse(options.body));
    return completion('The candidate worked at Acme.');
  });
  const question = 'Which companies has the candidate worked for?';
  assert.equal(await rewriteQuestion(question, history), question);
  assert.equal(requests.length, 0);
  await generateAnswer(question, '[Source 1 | Page 1] Acme.', history);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].reasoning_effort, 'low');
  assert.match(requests[0].messages[0].content, /STRICT PDF-ONLY/);
  assert.match(requests[0].messages.at(-1).content, /Acme/);
});

test('GPT-OSS reasoning effort can be increased for complex PDFs', async t => {
  setup(t);
  const oldEffort = process.env.GROQ_REASONING_EFFORT;
  process.env.GROQ_REASONING_EFFORT = 'medium';
  t.after(() => {
    if (oldEffort === undefined) delete process.env.GROQ_REASONING_EFFORT;
    else process.env.GROQ_REASONING_EFFORT = oldEffort;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(JSON.parse(options.body).reasoning_effort, 'medium');
    return completion('Supported answer');
  });
  await generateAnswer('Question', 'PDF context');
});

test('referential, short and elliptical follow-ups still use the rewrite model', async t => {
  setup(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(JSON.parse(options.body));
    return completion('Where did the candidate use React and Node.js?');
  });
  for (const question of [
    'where he used them?', 'What about education?', 'Tell me more',
    'Which of those technologies were used?', 'Explain the second project in detail',
    'Why did the candidate choose React?',
  ]) {
    assert.match(await rewriteQuestion(question, history), /React and Node/);
  }
  assert.equal(calls.length, 6);
});

test('first questions skip rewriting and preserve their original text', async t => {
  const mock = t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected model call'));
  assert.equal(await rewriteQuestion('  What skills?  ', []), 'What skills?');
  assert.equal(mock.mock.callCount(), 0);
});

test('slow rewrite times out and falls back without waiting for the answer deadline', async t => {
  setup(t);
  const oldTimeout = process.env.QUESTION_REWRITE_TIMEOUT_MS;
  process.env.QUESTION_REWRITE_TIMEOUT_MS = '20';
  t.after(() => {
    if (oldTimeout === undefined) delete process.env.QUESTION_REWRITE_TIMEOUT_MS;
    else process.env.QUESTION_REWRITE_TIMEOUT_MS = oldTimeout;
  });
  let upstreamAborted = false;
  t.mock.method(globalThis, 'fetch', (url, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(completion('Too late')), 1000);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      upstreamAborted = true;
      reject(signal.reason);
    }, { once: true });
  }));
  assert.equal(await rewriteQuestion('Where did he use them?', history), 'Where did he use them?');
  assert.equal(upstreamAborted, true);
});

test('caller cancellation stops rewriting instead of continuing with a fallback', async t => {
  setup(t);
  const controller = new AbortController();
  const reason = new Error('Client disconnected');
  t.mock.method(globalThis, 'fetch', async () => {
    controller.abort(reason);
    throw reason;
  });
  await assert.rejects(rewriteQuestion('Where did he use them?', history, { signal: controller.signal }), reason);
});

test('oversized rewrites fall back instead of failing downstream embedding validation', async t => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async () => completion('x'.repeat(601)));
  assert.equal(await rewriteQuestion('Where did he use them?', history), 'Where did he use them?');
});
