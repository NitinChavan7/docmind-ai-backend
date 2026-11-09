const fs = require("fs/promises");
const { PDFParse } = require("pdf-parse");

const extractPdfText = async (filePath) => {
  const buffer = await fs.readFile(filePath);

  const parser = new PDFParse({
    data: new Uint8Array(buffer),
  });

  try {
    const info = await parser.getInfo();

    const pageCount = info.total;
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
};
