# Document module

This module owns the PDF lifecycle: upload private bytes, save metadata, show a PDF, turn text into searchable vectors and delete related data. A candidate is represented by an owned document; the backend has no separate Candidate collection.

## Files and libraries

| File | Purpose | Libraries/APIs |
| --- | --- | --- |
| [index.js](index.js) | Mount PDF routes | `express`, upload/operation middleware |
| [controller/index.js](controller/index.js) | Coordinate upload, queries, serving, indexing and deletion | `mongoose`, Node `fs/promises`, `path`, internal services |
| [repository/index.js](repository/index.js) | Query/update owned documents; delete related MongoDB records | Mongoose `Document`, `Chat`, `Message` |
| [services/pdf.service.js](services/pdf.service.js) | Extract page text | `pdf-parse` (`PDFParse`), `fs/promises` |
| [services/chunk.service.js](services/chunk.service.js) | Split page text into overlapping chunks | Plain JavaScript |
| [services/operation.service.js](services/operation.service.js) | Database lease for conflicting work | Mongoose `Document`, Node `crypto`, timers |
| [schema/index.js](schema/index.js) | Empty placeholder | Not an active validator/schema |

Multer upload storage/filtering lives in [middleware/upload.middleware.js](../../middleware/upload.middleware.js), not in this folder. Mongoose field validation lives in the [Document model](../database/models/Document.README.md).

## Routes and controller functions

All paths below start with `/api/documents` and require authentication. All mutations require CSRF.

| Route | Function | What it does |
| --- | --- | --- |
| POST `/upload` | `uploadDocument(req,res)` | Requires multipart `file`, checks `%PDF-` signature, saves metadata with `req.user.id` |
| GET `/` | `getDocuments(req,res)` | Lists only the user's PDFs, newest first |
| GET `/:documentId` | `getDocument(req,res)` | Returns owned metadata or 404 |
| GET `/:documentId/file` or `/view` | `viewDocument(req,res)` | Checks ownership and serves private PDF bytes inline |
| POST `/:documentId/process` | `processDocument(req,res)` | Extracts text, chunks it, embeds it, stores vectors and marks ready |
| DELETE `/:documentId` | `deleteDocument(req,res)` | Removes applicable vectors, PDF file and related MongoDB data |

`formatDocument(document)` is an internal response mapper. It returns ID, original name, size, MIME type, status, page count and timestamps; it leaves out private paths, stored filenames and lease fields.

## Repository functions

| Function | Result / behavior |
| --- | --- |
| `registerDocument(data)` | Creates metadata with status `uploaded` and pageCount 0; trusted caller supplies ownership |
| `getAllDocuments(userId)` | Returns lean owned records sorted newest first |
| `getDocumentById(documentId,userId)` | Returns one lean owned record or null |
| `updateDocumentStatus(documentId,userId,status,pageCount)` | Updates status and optional page count; runs schema validation |
| `deleteDocumentById(documentId,userId)` | Deletes owned messages/chats for that document, then its metadata |

Repository deletion does not remove disk files or Chroma vectors by itself. The controller coordinates those operations first. Cleanup spans multiple stores and is not a single transaction; a failed deletion can need a retry.

## Service functions and indexing flow

`extractPdfText(filePath)` reads a PDF buffer, constructs `PDFParse`, calls `getInfo()` for page count and `getText({partial:[pageNumber]})` for each page. It returns `{pageCount,pages:[{pageNumber,text}]}` and always destroys the parser. There is no OCR; image-only scans may produce no searchable text.

`splitTextIntoChunks(pages,documentId,chunkSize=1000,chunkOverlap=200)` normalizes whitespace per page and returns `{documentId,pageNumber,chunkNumber,content}` chunks. Sizes count JavaScript string characters, not model tokens. Numbering starts at chunk 0 on each page. Overlap preserves context near chunk boundaries. Invalid size/overlap configuration throws.

`processDocument` marks `processing`, calls these two functions, sends chunk contents to `generateEmbeddings`, upserts them through `storeDocumentChunks`, then marks `ready` with the page count. No text or another processing failure marks `failed` after processing has started. The route holds a document lease during this work.

`withDocumentOperation(userId,documentId,operation,{signal,onLeaseLost}={})` acquires an owned MongoDB lease using a UUID. It rejects an absent document with 404 and busy work with 409. A ten-minute expiry is extended every 30 seconds. The callback receives `(document,ensureLease)`; streaming can use its signal checks and lease-loss callback to stop upstream work. `finally` clears the heartbeat and releases the lease. It coordinates indexing, deletion and chat operations, not a general-purpose transaction.

## Usage, settings and limits

Upload a PDF as multipart field `file` (10 MiB maximum), POST its returned ID to `/:documentId/process`, then use a chat tied to that ready ID. Reads use the server-generated filename inside the private upload directory. The directory is not publicly mounted.

Unowned legacy uploads are inaccessible through user routes. Ownership comes from the verified session, never a body `userId`. Indexing needs Ollama and Chroma configured as described in the [RAG guide](../rag/README.md). The schema accepts `extracted` for compatibility, but the active processing path currently uses `uploaded -> processing -> ready` or `failed`.
