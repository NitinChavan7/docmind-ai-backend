const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 80;

/**
 * Split PDF page text into smaller overlapping chunks.
 *
 * Designed for Qdrant Cloud Inference using:
 * sentence-transformers/all-minilm-l6-v2
 *
 * Each chunk stays within the application's 600-character
 * validation limit.
 *
 * Note: Character count is not the same as token count.
 * Token-aware chunking is needed for a strict 256-token limit.
 */
const splitTextIntoChunks = (
  pages,
  documentId,
  chunkSize = DEFAULT_CHUNK_SIZE,
  chunkOverlap = DEFAULT_CHUNK_OVERLAP,
) => {
  if (
    !Number.isInteger(chunkSize) ||
    !Number.isInteger(chunkOverlap) ||
    chunkSize <= 0 ||
    chunkSize > 600 ||
    chunkOverlap < 0 ||
    chunkOverlap >= chunkSize
  ) {
    throw new Error("Invalid chunk configuration");
  }

  if (!Array.isArray(pages)) {
    throw new Error("Pages must be an array");
  }

  const chunks = [];

  for (const page of pages) {
    const text = String(page?.text || "")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) continue;

    let start = 0;
    let chunkNumber = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);

      const content = text.slice(start, end).trim();

      if (content) {
        chunks.push({
          documentId: String(documentId),
          pageNumber: page.pageNumber,
          chunkNumber,
          content,
        });
      }

      if (end === text.length) {
        break;
      }

      start = end - chunkOverlap;
      chunkNumber++;
    }
  }

  return chunks;
};

module.exports = {
  splitTextIntoChunks,
};
