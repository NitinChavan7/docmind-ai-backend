# AI models

Qdrant creates embeddings for document search, and Groq rewrites questions and generates answers. Both models run through hosted services. This repository does not train or fine-tune them.

| Job | Provider | Default model | Configuration |
| --- | --- | --- | --- |
| Rewrite follow-ups and generate answers | Groq | `openai/gpt-oss-20b` | `GROQ_MODEL` |
| Embed PDF chunks and search questions | Qdrant Cloud Inference | `sentence-transformers/all-minilm-l6-v2` | `QDRANT_EMBEDDING_MODEL` |

- [Groq chat model](groq/README.md): prompts, completion limits and streaming.
- [MiniLM embeddings](minilm/README.md): inference inputs, collection compatibility and search.
- [Prompt engineering](../PROMPT_ENGINEERING.md): how questions, history and PDF context become model messages.

```text
Index: PDF -> page text -> chunks -> Qdrant inference -> stored vectors
Ask: question/history -> optional Groq rewrite -> Qdrant inference/search
Answer: original question + history + retrieved passages -> Groq -> text/SSE
```

Changing the chat model leaves stored vectors intact. Changing the embedding model requires a compatible collection and reindexing; matching dimensions alone does not make vectors from different models interchangeable.

The [llama3.2:3b](llama3.2-3b/README.md) and [nomic-embed-text](nomic-embed-text/README.md) pages record the previous local setup. They are not current installation requirements.
