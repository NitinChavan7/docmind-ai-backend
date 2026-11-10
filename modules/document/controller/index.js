const mongoose = require("mongoose");
const fs = require("fs/promises");
const path = require("path");
const { extractPdfText } = require("../services/pdf.service");
const { splitTextIntoChunks } = require("../services/chunk.service");
// const { generateEmbeddings } = require("../../rag/services/embedding.service");
const os = require("os");

const {
  uploadPdf,
  downloadPdf,
  deletePdf,
} = require("../services/storage.service");
const {
  storeDocumentChunks,
  deleteDocumentChunks,
} = require("../../rag/services/vector.service");
const {
  registerDocument,
  getAllDocuments,
  getDocumentById,
  updateDocumentStatus,
  deleteDocumentById,
} = require("../repository");

const uploadDirectory = path.resolve(__dirname, "../../../uploads");

// Only expose safe document metadata
const formatDocument = (document) => ({
  documentId: document._id,
  originalName: document.originalName,
  fileSize: document.fileSize,
  mimeType: document.mimeType,
  status: document.status,
  pageCount: document.pageCount,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

class DocumentController {
  // POST /api/documents/upload

  async uploadDocument(req, res) {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        type: "ValidationError",
        message: "Please upload a PDF file",
      });
    }

    let objectKey = null;
    let savedDocument = false;

    try {
      const fileBuffer = await fs.readFile(req.file.path);

      // Validate PDF signature.
      if (
        fileBuffer.length < 5 ||
        fileBuffer.subarray(0, 5).toString("ascii") !== "%PDF-"
      ) {
        return res.status(400).json({
          success: false,
          type: "ValidationError",
          message: "Invalid PDF file",
        });
      }

      if (fileBuffer.length > 10 * 1024 * 1024) {
        return res.status(413).json({
          success: false,
          message: "PDF must be under 10 MB",
        });
      }

      // Use the server-generated filename, never the user filename.
      objectKey = `${req.user.id}/${req.file.filename}`;

      await uploadPdf(objectKey, fileBuffer);

      const document = await registerDocument({
        userId: req.user.id,
        originalName: req.file.originalname,
        fileName: req.file.filename,
        filePath: objectKey,
        mimeType: "application/pdf",
        fileSize: fileBuffer.length,
      });

      savedDocument = true;

      return res.status(201).json({
        success: true,
        message: "PDF uploaded successfully",
        data: formatDocument(document),
      });
    } catch (error) {
      console.error("Upload error:", error.message);

      // Compensate for a failed MongoDB write.
      if (objectKey && !savedDocument) {
        try {
          await deletePdf(objectKey);
        } catch (cleanupError) {
          console.error("Storage cleanup failed:", cleanupError.message);
        }
      }

      return res.status(500).json({
        success: false,
        message: "Failed to upload PDF",
      });
    } finally {
      await fs.unlink(req.file.path).catch((error) => {
        if (error.code !== "ENOENT") {
          console.error("Temporary file cleanup failed:", error.message);
        }
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

      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("X-Content-Type-Options", "nosniff");

      return res.status(200).send(pdfBuffer);
    } catch (error) {
      console.error("View document error:", error.message);

      return res.status(404).json({
        success: false,
        message: "PDF file not available",
      });
    }
  }

  // DELETE /api/documents/:documentId

  async deleteDocument(req, res) {
    try {
      const { documentId } = req.params;
      const userId = req.user.id;

      // 1. Validate MongoDB document ID
      if (!mongoose.isValidObjectId(documentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      // 2. Verify that the document belongs to this user
      const document = await getDocumentById(documentId, userId);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      // 3. Delete document vectors from Qdrant Cloud.
      // Also clean up possible partial indexing attempts.
      console.log("[Document] Deleting Qdrant vectors");

      await deleteDocumentChunks(documentId, userId);

      // 4. Delete the PDF from private Supabase Storage
      const objectKey = document.filePath;

      if (typeof objectKey === "string" && objectKey.startsWith(`${userId}/`)) {
        console.log("[Document] Deleting PDF from Supabase");
        await deletePdf(objectKey);
      }

      // 5. Delete document metadata from MongoDB Atlas
      await deleteDocumentById(documentId, userId);

      console.log("[Document] Document deleted successfully");

      return res.status(200).json({
        success: true,
        message: "Document deleted successfully",
      });
    } catch (error) {
      console.error("Delete document error:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        message: "Failed to delete document",
      });
    }
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
      // STEP 5: Create temporary PDF file
      // ============================================

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
