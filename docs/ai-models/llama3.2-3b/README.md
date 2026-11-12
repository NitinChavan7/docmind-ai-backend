# llama3.2:3b (retired)

This guide records the earlier Ollama setup, which used `llama3.2:3b` for question rewriting and PDF answers. The active [LLM service](../../../modules/rag/services/llm.service.js) calls Groq and defaults to `openai/gpt-oss-20b`.

`OLLAMA_BASE_URL` and `OLLAMA_CHAT_MODEL` no longer configure the active service. Pulling an Ollama model is not required for the current app. Some tests still simulate Ollama and need migration before they can validate the Groq integration.

Use the [Groq model guide](../groq/README.md) for setup, limits and diagnostics, or the [AI model index](../README.md) for the current pipeline.
