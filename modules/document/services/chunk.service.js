const splitTextIntoChunks = (
  pages,
  documentId,
  chunkSize = 1000,
  chunkOverlap = 200,
) => {
  if (chunkSize <= 0 || chunkOverlap < 0 || chunkOverlap >= chunkSize) {
    throw new Error("Invalid chunk configuration");
  }

  const chunks = [];

  for (const page of pages) {
    const text = page.text.replace(/\s+/g, " ").trim();

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

      if (end === text.length) break;

      start = end - chunkOverlap;
      chunkNumber++;
    }
  }

  return chunks;
};

module.exports = {
  splitTextIntoChunks,
};
