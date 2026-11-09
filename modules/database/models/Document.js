const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    operationKey: { type: String, default: null },
    operationUntil: { type: Date, default: null },
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
const Document = mongoose.model("Document", documentSchema, "documents");
module.exports = Document;
