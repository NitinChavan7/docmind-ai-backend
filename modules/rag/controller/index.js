const mongoose = require("mongoose");
const { withGenerationSlot } = require("../../chat/services/generation.service");

const { getReadyDocument } = require("../repository");

const { askDocument } = require("../services/rag.service");

class RagController {
  async askQuestion(req, res) {
    try {
      const { documentId, question } = req.body || {};

      // Validate question
      if (typeof question !== "string" || !question.trim() || question.length > 4000) {
        return res.status(400).json({
          success: false,
          message: "Question is required",
        });
      }

      // Validate document ID
      if (!mongoose.isValidObjectId(documentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid document ID",
        });
      }

      // Verify PDF is indexed
      const document = await getReadyDocument(documentId, req.user.id);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found or not indexed",
        });
      }

      // Call RAG service
      const result = await withGenerationSlot(req.user.id, () => askDocument(documentId, question.trim()));

      return res.status(200).json({
        success: true,
        message: "Answer generated successfully",
        data: {
          documentId,
          question: question.trim(),
          answer: result.answer,
          sources: result.sources,
        },
      });
    } catch (error) {
      if (error.status === 429) return res.status(429).json({ success: false, message: error.message });
      console.error("RAG API error:", error.name);

      return res.status(500).json({
        success: false,
        message: "Failed to generate answer",
        ...(process.env.NODE_ENV !== "production" && {
          error: error.message,
        }),
      });
    }
  }
}

module.exports = new RagController();
