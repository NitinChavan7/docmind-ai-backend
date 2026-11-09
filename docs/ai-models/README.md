# Ollama models used by DocMind

These are AI models served by Ollama, not JavaScript packages or MongoDB models. The backend calls them over HTTP using Node's built-in `fetch`.

| Model | Job in this project | Used by | Guide |
| --- | --- | --- | --- |
| `llama3.2:3b` (default) | Clarify questions and generate answer text | `llm.service.js` | [Chat model](llama3.2-3b/README.md) |
| `nomic-embed-text` | Turn PDF chunks/questions into numeric search vectors | `embedding.service.js` | [Embedding model](nomic-embed-text/README.md) |

## How they work together

```text
Indexing: PDF -> page text -> chunks -> nomic-embed-text -> Chroma vectors
Question: question/history -> llama3.2:3b rewrite -> nomic-embed-text -> Chroma evidence
Answer: original question + history + evidence -> llama3.2:3b -> JSON answer or SSE tokens
```

Install/pull models on the machine running Ollama, not with `npm install`:

```powershell
ollama pull llama3.2:3b
ollama pull nomic-embed-text
ollama list
```

The backend uses `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`). The chat model is configurable through `OLLAMA_CHAT_MODEL`; the embedding model name is currently hard-coded. Read each guide before changing models, especially before changing a collection's embedding dimensions.

The code does not train or fine-tune these models. It passes context at inference time. It does not implement web search or a general-purpose model-selection UI. Performance and memory requirements depend on the actual Ollama installation, model artifact and hardware; this repository does not measure or guarantee them.
