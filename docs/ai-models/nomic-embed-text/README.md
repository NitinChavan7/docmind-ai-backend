# nomic-embed-text (retired)

This guide records the earlier embedding setup: Ollama ran `nomic-embed-text`, and Chroma stored its vectors. The active embedding and vector services send text to Qdrant Cloud Inference with `sentence-transformers/all-minilm-l6-v2` by default.

The old `generateEmbeddings` export is no longer present. `testEmbedding.js` and `testSearch.js` still depend on that export and need updating before use. Existing vectors from the previous model cannot be reused as MiniLM vectors; documents need reindexing into a compatible Qdrant collection.

Use the [MiniLM guide](../minilm/README.md) for the current inputs, collection settings and diagnostics. Local Ollama model installation is no longer part of normal setup.
