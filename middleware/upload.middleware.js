const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const limits = require('../config/usage-limits');
const { usageError } = require('../modules/usage/errors');

const uploadPath = path.join(__dirname, "../uploads");

// Create uploads folder if it doesn't exist
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, {
    recursive: true,
  });
}

// Configure file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },

  filename: (req, file, cb) => {
    const uniqueFileName = `${crypto.randomUUID()}.pdf`;

    cb(null, uniqueFileName);
  },
});

// Allow only PDFs
const fileFilter = (req, file, cb) => {
  if (file.mimetype === "application/pdf") {
    cb(null, true);
  } else {
    cb(usageError(400, 'INVALID_PDF_FILE', 'Only PDF files are allowed.'));
  }
};

// Configure Multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    // Multer may flag a stream exactly at its cap; allow one extra byte here
    // and enforce the inclusive configured boundary against the actual buffer.
    fileSize: limits.maxPdfSizeBytes + 1,
    files: 1,
  },
});

// Important: Export Multer instance directly
module.exports = upload;
