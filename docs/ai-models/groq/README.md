# Groq: question rewriting and answers

The backend defaults to `openai/gpt-oss-20b` through Groq's chat completions endpoint. Set `GROQ_API_KEY` on the server and optionally override `GROQ_MODEL`.

Source: [llm.service.js](../../../modules/rag/services/llm.service.js).

## Responsibilities

`rewriteQuestion` uses up to six recent saved messages to turn a follow-up into a standalone search query. It skips the model call when history is empty or a conservative local check identifies a standalone question. Short and referential questions still use rewriting. Rewriting times out after eight seconds by default (`QUESTION_REWRITE_TIMEOUT_MS`); failures fall back to the original question unless the caller cancelled the request. Rewrites over the 600-character embedding limit also fall back.

`generateAnswer` returns a full answer; `streamAnswer` yields text deltas. Both use `buildAnswerMessages`, which adds the same PDF-grounding instructions, up to eight saved messages and the retrieved passages. The answer model receives the original question.

Requests use Node's built-in `fetch`, temperature 0.2 and `max_completion_tokens`: 512 for rewriting, 2,048 by default for answers. Groq calls have a 120-second deadline and honor caller cancellation.

Streaming reads Groq SSE, forwards only content deltas, requires `[DONE]` and a `stop` finish reason, and rejects empty or incomplete answers. Streamed answers are capped at 20,000 characters. The chat layer saves a completed turn before emitting its own `done` event to the frontend.

## Configuration and checks

```dotenv
GROQ_API_KEY=<server-side-api-key>
GROQ_MODEL=openai/gpt-oss-20b
GROQ_REASONING_EFFORT=low
QUESTION_REWRITE_TIMEOUT_MS=8000
```

The shared answer prompt requires PDF-only answers, limits history to resolving follow-ups and specifies an exact response for unsupported questions. The model is also instructed to identify missing portions of partly supported questions. These rules guide generation but are not an independent check of the answer.

For GPT-OSS 20B/120B, `GROQ_REASONING_EFFORT` accepts `low` (default), `medium` or `high`. Low favors latency; higher effort gives the model more room for complex reasoning. Other models are sent no reasoning-effort parameter. See the [Groq API reference](https://console.groq.com/docs/api-reference).

Restart after changing the model. `node test-groq.js` makes live non-streaming and streaming requests using sample context; it does not test retrieval or persistence.

Changing this model does not require reindexing PDFs. It can change prompt behavior, output quality and provider limits. Answers remain model-generated; verify important claims against their PDF sources. See [prompt engineering](../../PROMPT_ENGINEERING.md).
