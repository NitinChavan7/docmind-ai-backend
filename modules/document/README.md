# PDF documents

This module uploads, previews, indexes and deletes a user's PDFs. MongoDB stores metadata, Supabase stores PDF bytes, and Qdrant stores searchable chunks.

## Files

| Path | Responsibility |
| --- | --- |
| [index.js](index.js) | Document routes |
| [controller/index.js](controller/index.js) | Coordinate storage, metadata, processing and cleanup |
| [repository/index.js](repository/index.js) | Owner-scoped MongoDB queries and related-record deletion |
| [services/storage.service.js](services/storage.service.js) | Supabase `uploadPdf`, `downloadPdf` and `deletePdf` |
| [services/pdf.service.js](services/pdf.service.js) | Extract text page by page using `PDFParse` |
| [services/chunk.service.js](services/chunk.service.js) | Normalize whitespace and split page text |
| [services/operation.service.js](services/operation.service.js) | Renewable MongoDB lease for conflicting operations |
| [schema/index.js](schema/index.js) | Unused placeholder; validation lives in the model/controller |

## Routes

All paths start with `/api/documents`. Authentication is required; mutations also require CSRF.

| Method | Path | Action |
| --- | --- | --- |
| POST | `/upload` | Upload multipart field `file` |
| GET | `/` | List the user's documents, newest first |
| GET | `/:documentId` | Read safe metadata |
| GET | `/:documentId/view` or `/:documentId/file` | Return private PDF bytes inline |
| POST | `/:documentId/process` | Extract, chunk and index the PDF |
| DELETE | `/:documentId` | Remove vectors, PDF and related application records |

## Upload and storage

Multer writes a temporary file under `uploads/` with a generated UUID filename. The controller checks the `%PDF-` signature and 10 MiB limit, uploads to Supabase at `<userId>/<generated-filename>`, and saves that object key in `Document.filePath`. The temporary upload is removed in `finally`. If metadata creation fails, the controller attempts to remove the uploaded object.

Preview and processing check ownership and the owner prefix in the storage key before downloading. PDF responses use `private, no-store`. Public metadata excludes storage keys and lease fields. Old local paths do not satisfy this storage-key check and require reuploading.

## Indexing

1. Download the PDF and write it in a new temporary processing directory.
2. Mark the document `processing` and extract text for each page.
3. Split normalized text into 500-character chunks with 80-character overlap. Page numbering is one-based; chunk numbering starts at zero on each page.
4. Send chunks to Qdrant, which creates embeddings through Cloud Inference. No local embedding call is made.
5. Mark `ready` only when Qdrant confirms all chunks. Record the page count and remove temporary processing files.

A failure after processing starts marks the document `failed`. Empty/scanned PDFs without extractable text cannot be indexed; there is no OCR. Chunk size can be configured internally up to 600 characters, with overlap smaller than the chunk size. Character limits are not token limits.

## Concurrency and deletion

`withDocumentOperation(userId,documentId,operation,options)` acquires a ten-minute MongoDB lease and renews it every 30 seconds. Missing documents return 404 and busy documents 409. Processing and deletion routes use the operation middleware; chat operations use the same service.

Deletion removes owner/document-filtered Qdrant points, the owner-scoped Supabase object, then MongoDB messages, chats and document metadata. This spans separate stores and is not a transaction; retry after a cleanup failure. The repository alone only deletes MongoDB records.

Configure `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_BUCKET` and the Qdrant variables in [configuration](../../config/README.md). Keep the bucket private and its secret key on the server.

## Free-plan quotas and retention

See [the free-plan guide](../../docs/FREE_PLAN.md) for backend limits, explicit expiry, retryable cleanup, migration commands and scheduler requirements. Uploads are parser-inspected before private storage; quota decisions are persisted in MongoDB. Physical cleanup requires an external scheduler and is not automatically enabled.
