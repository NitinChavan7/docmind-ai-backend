const mongoose = require("mongoose");
const fs = require("fs/promises");
const path = require("path");
const { extractPdfText } = require("../services/pdf.service");
const { splitTextIntoChunks } = require("../services/chunk.service");
const { generateEmbeddings } = require("../../rag/services/embedding.service");

const { storeDocumentChunks, deleteDocumentChunks } = require("../../rag/services/vector.service");
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

    try {
      // Read the first five bytes of the uploaded file
      const handle = await fs.open(req.file.path, "r");
      const header = Buffer.alloc(5);
      let bytesRead;

      try {
        ({ bytesRead } = await handle.read(header, 0, 5, 0));
      } finally {
        await handle.close();
      }

      // Validate the PDF file signature
      if (bytesRead !== 5 || header.toString("ascii") !== "%PDF-") {
        await fs.unlink(req.file.path);

        return res.status(400).json({
          success: false,
          type: "ValidationError",
          message: "Invalid PDF file",
        });
      }

      const requestBody = {
        userId: req.user.id,
        originalName: req.file.originalname,
        fileName: req.file.filename,
        filePath: req.file.path,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
      };

      // Store metadata in MongoDB
      const document = await registerDocument(requestBody);

      return res.status(201).json({
        success: true,
        message: "PDF uploaded successfully",
        data: formatDocument(document),
      });
    } catch (error) {
      // Remove uploaded file if database save fails
      await fs.unlink(req.file.path).catch(() => {});

      console.error("Upload error:", error.name);

      return res.status(500).json({
        success: false,
        type: error.name,
        message: "Failed to upload PDF",
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

      // Only use the server-generated filename
      const filePath = path.join(uploadDirectory, document.fileName);

      await fs.access(filePath);

      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "application/pdf");

      res.setHeader("Content-Disposition", "inline");

      return res.sendFile(filePath);
    } catch (error) {
      console.error("View document error:", error);

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

      const filePath = path.join(uploadDirectory, document.fileName);

      if (document.status !== "uploaded") await deleteDocumentChunks(documentId);

      // Delete PDF file
      await fs.unlink(filePath).catch((error) => {
        if (error.code !== "ENOENT") {
          throw error;
        }
      });

      // Delete MongoDB record
      await deleteDocumentById(documentId, req.user.id);

      return res.status(200).json({
        success: true,
        message: "Document deleted successfully",
      });
    } catch (error) {
      console.error("Delete document error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to delete document",
      });
    }
  }

  async processDocument(req, res) {
    const { documentId } = req.params;
    let processingStarted = false;

    try {


      // Validate MongoDB ID
      if (!mongoose.isValidObjectId(documentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      // Find document in MongoDB
      const document = await getDocumentById(documentId, req.user.id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found",
        });
      }

      // The database lease prevents overlap and permits recovery after a crashed worker.

      // Get uploaded PDF path
      const filePath = path.join(uploadDirectory, document.fileName);


      // Mark document as processing
      await updateDocumentStatus(documentId, req.user.id, "processing");

      processingStarted = true;

      // Extract text from PDF


      const result = await extractPdfText(filePath);


      // Split extracted text into chunks
      const chunks = splitTextIntoChunks(result.pages, documentId);


      if (chunks.length === 0) {
        throw new Error("No searchable text found in PDF");
      }

      // Step 1: Prepare extracted text chunks
      const texts = chunks.map((chunk) => chunk.content);

      // Step 2: Generate embeddings using Ollama


      const embeddings = await generateEmbeddings(texts);


      // Step 3: Save vectors in ChromaDB


      const vectorResult = await storeDocumentChunks(chunks, embeddings);


      // Step 4: Mark document as ready
      await updateDocumentStatus(documentId, req.user.id, "ready", result.pageCount);


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
      console.error("PDF processing failed:", error.name);

      if (processingStarted) {
        await updateDocumentStatus(documentId, req.user.id, "failed").catch(
          (updateError) => {
            console.error("Failed to update document status:", updateError);
          },
        );
      }

      return res.status(500).json({
        success: false,
        message: "PDF processing failed",
        ...(process.env.NODE_ENV !== "production" && {
          error: error.message,
        }),
      });
    }
  }
}

module.exports = new DocumentController();
