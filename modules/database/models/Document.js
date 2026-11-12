const mongoose = require("mongoose");
const limits = require('../../../config/usage-limits');

const documentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    operationKey: { type: String, default: null },
    operationUntil: { type: Date, default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + limits.pdfRetentionDays * limits.DAY_MS) },
    deletionPending: { type: Boolean, default: false },
    deletionAttempts: { type: Number, default: 0 },
    uploadState: { type: String, enum: ['pending', 'complete'], default: 'complete' },
    uploadUntil: { type: Date, default: null },
    contentHash: { type: String },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },

    fileName: {
      type: String,
      required: true,
    },

    filePath: {
      type: String,
      required: true,
    },

    mimeType: {
      type: String,
      required: true,
    },

    fileSize: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["uploaded", "processing", "extracted", "ready", "failed"],
      default: "uploaded",
    },

    pageCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

documentSchema.index({ userId: 1, createdAt: -1 });
documentSchema.index({ userId: 1, contentHash: 1 });
documentSchema.index({ expiresAt: 1, deletionPending: 1 });
documentSchema.index({ deletionPending: 1, uploadState: 1, uploadUntil: 1 });
const Document = mongoose.model("Document", documentSchema, "documents");
module.exports = Document;
