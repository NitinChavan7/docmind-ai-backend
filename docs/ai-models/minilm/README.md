# MiniLM: PDF and question embeddings

The embedding service defaults to `sentence-transformers/all-minilm-l6-v2`. Qdrant Cloud Inference converts chunk text and search questions into vectors; Node does not download or run the model.

Sources: [embedding.service.js](../../../modules/rag/services/embedding.service.js), [vector.service.js](../../../modules/rag/services/vector.service.js).

## Input and retrieval

`createInferenceDocument(text)` trims nonempty text, rejects input longer than 600 characters and returns `{text,model}`. `prepareEmbeddingDocuments` applies that validation to an array. These functions return inference descriptions, not numeric embeddings.

Indexing uses 500-character chunks with 80-character overlap. The vector service upserts batches of 16, passing inference descriptions directly as vectors. Searches pass the question in the same form and filter by authenticated user and document IDs. The RAG service requests five matches, then orders them by page and chunk for the answer prompt. The query does not set a minimum relevance score.

The default MiniLM integration uses 384-dimensional vectors. Create a compatible collection before indexing; the runtime service only reads the collection and inserts/searches points. Set `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION` (default `document_chunks_v2`) and optionally `QDRANT_EMBEDDING_MODEL`.

The 600-character check is a text-length approximation, not a strict token budget. Long questions or rewrites can exceed it and fail retrieval. Changing the embedding model requires checking vector configuration and reindexing in a compatible collection.

## Diagnostics

`node test-qdrant.js` lists collections. `node test-qdrant-inference.js` inserts a sample inference point, searches, then attempts to delete that point. That inference diagnostic hard-codes `document_chunks_v2` and the default model, so review it if your configuration differs.

The old `setup-qdrant.js` creates 768-dimensional vectors and defaults to `document_chunks`; it does not provision the current MiniLM collection correctly as written.
