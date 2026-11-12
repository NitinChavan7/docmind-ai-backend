const fs = require("fs/promises");
const { PDFParse } = require("pdf-parse");
const limits = require('../../../config/usage-limits');
const { usageError } = require('../../usage/errors');

const validatePageCount = pageCount => {
  if (!Number.isInteger(pageCount) || pageCount < 1) throw usageError(400, 'INVALID_PDF_FILE', 'This PDF has no readable pages.');
  if (pageCount > limits.maxPdfPages) throw usageError(413, 'PDF_PAGE_LIMIT_EXCEEDED', `PDFs can contain up to ${limits.maxPdfPages} pages.`, { limit: limits.maxPdfPages, pages: pageCount });
  return pageCount;
};
const inspectPdfBuffer = async (buffer, mimeType = 'application/pdf') => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || mimeType !== 'application/pdf' || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw usageError(400, 'INVALID_PDF_FILE', 'Please choose a valid PDF file.');
  }
  if (buffer.length > limits.maxPdfSizeBytes) throw usageError(413, 'PDF_SIZE_LIMIT_EXCEEDED', 'This PDF exceeds the file-size allowance.', { limit: limits.maxPdfSizeBytes, size: buffer.length });
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try { return validatePageCount((await parser.getInfo()).total); }
  catch (error) {
    if (error.public) throw error;
    throw usageError(400, 'INVALID_PDF_FILE', 'This PDF is malformed, encrypted or unsupported. Please choose another PDF.');
  } finally { await parser.destroy(); }
};

const extractPdfText = async (filePath) => {
  const buffer = await fs.readFile(filePath);

  const parser = new PDFParse({
    data: new Uint8Array(buffer),
  });

  try {
    const info = await parser.getInfo();

    const pageCount = validatePageCount(info.total);
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const result = await parser.getText({
        partial: [pageNumber],
      });

      pages.push({
        pageNumber,
        text: result.text.trim(),
      });
    }

    return {
      pageCount,
      pages,
    };
  } finally {
    await parser.destroy();
  }
};

module.exports = {
  extractPdfText,
  inspectPdfBuffer,
  validatePageCount,
};
