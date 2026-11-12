const mongoose = require("mongoose");
const fs = require("fs/promises");
const path = require("path");
const { extractPdfText } = require("../services/pdf.service");
const { splitTextIntoChunks } = require("../services/chunk.service");
// const { generateEmbeddings } = require("../../rag/services/embedding.service");
const os = require("os");

const { downloadPdf } = require("../services/storage.service");
const {
  storeDocumentChunks,
} = require("../../rag/services/vector.service");
const {
  getAllDocuments,
  getDocumentById,
  updateDocumentStatus,
} = require("../repository");

const { uploadDocument: uploadPrivateDocument } = require('../services/upload.service');
const { deleteDocumentRecords } = require('../../usage/cleanup.service');
const { sendError } = require('../../usage/errors');
const { inspectPdfBuffer, validatePageCount } = require('../services/pdf.service');
const { assertAvailable } = require('../../usage/resources');

// Only expose safe document metadata
const formatDocument = (document) => ({
  documentId: document._id,
  originalName: document.originalName,
  fileSize: document.fileSize,
  mimeType: document.mimeType,
  status: document.status,
  pageCount: document.pageCount,
  expiresAt: document.expiresAt || null,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

class DocumentController {
  // POST /api/documents/upload

  async uploadDocument(req, res, next) {
    if (!req.file) return sendError(res, require('../../usage/errors').usageError(400, 'INVALID_PDF_FILE', 'Please upload a PDF file.'));
    try {
      const buffer = await fs.readFile(req.file.path);
      const document = await uploadPrivateDocument(req.user.id, req.file, buffer);
      return res.status(201).json({ success: true, message: 'PDF uploaded successfully', data: formatDocument(document) });
    } catch (error) { return next(error); }
    finally {
      await fs.unlink(req.file.path).catch(error => {
        if (error.code !== 'ENOENT') console.error('[Upload] Temporary file cleanup deferred');
      });
    }
  }

  // GET /api/documents
  async getDocuments(req, res) {
    try {
      const documents = await getAllDocuments(req.user.id);

      return res.status(200).json({
        success: true,
        count: documents.length,
        data: documents.map(formatDocument),
      });
    } catch (error) {
      if (error.public) return sendError(res, error);
      console.error("Fetch documents error:", error);

      return res.status(500).json({
        success: false,
        type: error.name,
        message: "Failed to fetch documents",
      });
    }
  }

  // GET /api/documents/:documentId
  async getDocument(req, res) {
    try {
      const { documentId } = req.params;

      if (!mongoose.isValidObjectId(documentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const document = await getDocumentById(documentId, req.user.id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: formatDocument(document),
      });
    } catch (error) {
      if (error.public) return sendError(res, error);
      console.error("Get document error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch document",
      });
    }
  }

  // GET /api/documents/:documentId/file

  async viewDocument(req, res) {
    try {
      const { documentId } = req.params;

      if (!mongoose.isValidObjectId(documentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      const document = await getDocumentById(documentId, req.user.id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      const objectKey = document.filePath;

      // Newly uploaded files use an owner-scoped storage key.
      if (!objectKey || !objectKey.startsWith(`${req.user.id}/`)) {
        return res.status(404).json({
          success: false,
          message: "PDF must be uploaded again",
        });
      }

      const pdfBuffer = await downloadPdf(objectKey);
      assertAvailable(document);

      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("X-Content-Type-Options", "nosniff");

      return res.status(200).send(pdfBuffer);
    } catch (error) {
      if (error.public) return sendError(res, error);
      console.error("View document error:", error.message);

      return res.status(404).json({
        success: false,
        message: "PDF file not available",
      });
    }
  }

  // DELETE /api/documents/:documentId

  async deleteDocument(req, res, next) {
    try {
      await deleteDocumentRecords(req.documentOperation.document, req.documentOperation.ensureLease);
      return res.json({ success: true, message: 'Document deleted successfully' });
    } catch (error) { return next(error); }
  }

  async processDocument(req, res) {
    const { documentId } = req.params;

    let processingStarted = false;
    let temporaryDirectory = null;

    try {
      // ============================================
      // STEP 1: Validate MongoDB document ID
      // ============================================

      if (!mongoose.isValidObjectId(documentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      // ============================================
      // STEP 2: Verify document ownership
      // ============================================

      const document = await getDocumentById(documentId, req.user.id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      // ============================================
      // STEP 3: Validate Supabase storage key
      // ============================================

      const objectKey = document.filePath;

      if (
        typeof objectKey !== "string" ||
        !objectKey.startsWith(`${req.user.id}/`)
      ) {
        return res.status(404).json({
          success: false,
          message: "PDF must be uploaded again",
        });
      }

      // ============================================
      // STEP 4: Download PDF from Supabase Storage
      // ============================================

      console.log("[PDF] Downloading document from Supabase");

      const pdfBuffer = await downloadPdf(objectKey);

      if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
        throw new Error("Downloaded PDF is empty or invalid");
      }

      console.log(
        "[PDF] Download successful. Size:",
        pdfBuffer.length,
        "bytes",
      );

      // ============================================
      // STEP 5: Inspect before extraction or cloud inference
      // ============================================

      await inspectPdfBuffer(pdfBuffer);
      req.documentOperation?.ensureLease();
      temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "docmind-"));

      const filePath = path.join(temporaryDirectory, "document.pdf");

      await fs.writeFile(filePath, pdfBuffer);

      console.log("[PDF] Temporary file created");

      // ============================================
      // STEP 6: Mark document as processing
      // ============================================

      await updateDocumentStatus(documentId, req.user.id, "processing");

      processingStarted = true;

      // ============================================
      // STEP 7: Extract PDF text
      // ============================================

      console.log("[PDF] Extracting text");

      const result = await extractPdfText(filePath);

      if (
        !result ||
        !Array.isArray(result.pages) ||
        result.pages.length === 0
      ) {
        throw new Error("PDF text extraction returned no pages");
      }

      validatePageCount(result.pageCount);
      console.log("[PDF] Text extraction successful. Pages:", result.pageCount);

      // ============================================
      // STEP 8: Split PDF text into chunks
      // ============================================

      console.log("[PDF] Splitting document into chunks");

      const chunks = splitTextIntoChunks(result.pages, documentId);

      if (!Array.isArray(chunks) || chunks.length === 0) {
        throw new Error("No searchable text found in PDF");
      }

      console.log("[PDF] Total chunks generated:", chunks.length);

      // ============================================
      // STEP 9: Validate embedding input
      // ============================================

      for (const chunk of chunks) {
        if (typeof chunk.content !== "string" || !chunk.content.trim()) {
          throw new Error("Document contains an empty text chunk");
        }
      }

      // Qdrant Cloud's MiniLM model generates 384-dimensional
      // embeddings directly from the chunk text.
      //
      // Do NOT call generateEmbeddings() or local Ollama.

      // ============================================
      // STEP 10: Store chunks in Qdrant Cloud
      // ============================================

      console.log("[PDF] Sending chunks to Qdrant Cloud Inference");

      req.documentOperation?.ensureLease();
      const vectorResult = await storeDocumentChunks(chunks, req.user.id);

      if (!vectorResult || vectorResult.storedChunks !== chunks.length) {
        throw new Error("Qdrant did not confirm all document chunks");
      }

      console.log(
        "[PDF] Qdrant indexing completed:",
        vectorResult.storedChunks,
        "vectors",
      );

      // ============================================
      // STEP 11: Update MongoDB document status
      // ============================================

      req.documentOperation?.ensureLease();
      await updateDocumentStatus(
        documentId,
        req.user.id,
        "ready",
        result.pageCount,
      );

      console.log("[PDF] Document marked as ready");

      // ============================================
      // STEP 12: Return successful API response
      // ============================================

      return res.status(200).json({
        success: true,
        message: "PDF indexed successfully",
        data: {
          documentId,
          pageCount: result.pageCount,
          totalChunks: chunks.length,
          storedVectors: vectorResult.storedChunks,
          status: "ready",
        },
      });
    } catch (error) {
      // ============================================
      // ERROR HANDLING
      // ============================================

      console.error("PDF processing failed:", {
        name: error.name,
        message: error.message,
        cause: error.cause?.message,
        code: error.cause?.code,
        stack: error.stack,
      });

      // Only mark failed if processing was started.
      if (processingStarted) {
        try {
          await updateDocumentStatus(documentId, req.user.id, "failed");
        } catch (updateError) {
          console.error(
            "[PDF] Failed to update document status:",
            updateError.message,
          );
        }
      }

      if (error.public) return sendError(res, error);
      return res.status(500).json({
        success: false,
        message: "PDF processing failed",
        ...(process.env.NODE_ENV !== "production" && {
          error: error.message,
        }),
      });
    } finally {
      // ============================================
      // CLEAN UP TEMPORARY FILES
      // ============================================

      if (temporaryDirectory) {
        try {
          await fs.rm(temporaryDirectory, {
            recursive: true,
            force: true,
          });

          console.log("[PDF] Temporary files cleaned up");
        } catch (cleanupError) {
          console.error(
            "[PDF] Temporary cleanup failed:",
            cleanupError.message,
          );
        }
      }
    }
  }
}

module.exports = new DocumentController();
