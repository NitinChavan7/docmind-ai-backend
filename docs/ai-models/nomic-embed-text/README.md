# Embedding model: nomic-embed-text

This model converts text into numeric vectors for semantic search. It does not generate readable answers. Ollama serves it through `POST /api/embed`; the embedding service currently hard-codes the model name `nomic-embed-text`.

## Why it is used twice

During indexing, each PDF text chunk becomes a vector stored in Chroma alongside its text and page metadata. During a question, the clarified question becomes a vector that searches the same space. Matching query/document embedding models is essential; a chat-model answer is not an embedding.

## Functions and libraries

| Function/source | Responsibility |
| --- | --- |
| `generateEmbeddings(texts,{signal})` in [embedding.service.js](../../../modules/rag/services/embedding.service.js) | POSTs a nonempty text array; returns one vector per input |
| `DocumentController.processDocument` | Supplies chunk contents during indexing |
| `prepareDocumentAnswer` in [rag.service.js](../../../modules/rag/services/rag.service.js) | Supplies the rewritten question during retrieval |
| `storeDocumentChunks` / `searchDocumentChunks` in [vector.service.js](../../../modules/rag/services/vector.service.js) | Store/search supplied vectors using `chromadb` |

The Ollama calls use Node's `fetch` and `AbortSignal`, with a 120-second timeout and caller cancellation. No embedding SDK runs in the Node process. Chroma is configured with `embeddingFunction:null`, so its installed default embedding package is not the active model here.

## Input, output and dimensions

Request shape: `{model:'nomic-embed-text',input:['text one','text two']}`. The service returns `result.embeddings`, an array of number arrays. It validates that an embeddings array exists and its count matches input count; it does not validate every numeric entry or explicitly enforce the dimension.

This project's expected collection space is 768-dimensional. Inspect the actual runtime output using the root `testEmbedding.js` helper before changing indexing. All vectors within an existing Chroma collection must be compatible; do not mix vectors from a different model/dimension. A model change can require a separate collection and reindexing every PDF, even if dimensions happen to match.

## Usage

```powershell
ollama pull nomic-embed-text
node testEmbedding.js
```

Internal service example, with `.env` loaded before requiring the service:

```javascript
require('dotenv').config();
const { generateEmbeddings } = require('../../../modules/rag/services/embedding.service');
async function example() {
  const vectors = await generateEmbeddings(['The candidate knows React.']);
  console.log('Vector dimensions:', vectors[0].length);
  // vectors[0] is the search vector, not an answer.
}
example().catch(console.error);
```

That code fragment assumes a JavaScript file saved in this guide's directory and an already configured environment (dotenv's default lookup uses the working directory). `OLLAMA_BASE_URL` selects the Ollama host; there is no `OLLAMA_EMBED_MODEL` setting in the current source.

Whitespace cleanup and overlapping character chunks occur before embedding. OCR, explicit token-budget batching and custom embedding normalization are not implemented by this service.
