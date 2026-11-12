// A small real PDF fixture; no external service or PDF generator dependency.
const makePdf = (pages = 1, label = 'Fixture', targetSize) => {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids = [];
  for (let page = 0; page < pages; page++) {
    const pageId = objects.length;
    const streamId = pageId + 1;
    const text = `BT /F1 12 Tf 40 740 Td (${label.replace(/[()\\]/g, '')} page ${page + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${streamId} 0 R >>`);
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    kids.push(`${pageId} 0 R`);
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const trailer = offset => `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${String(offset).padStart(10, '0')}\n%%EOF\n`;
  const rawSize = Buffer.byteLength(body + trailer(Buffer.byteLength(body)));
  if (targetSize !== undefined && targetSize < rawSize) throw new Error('Target PDF size too small');
  body += ' '.repeat(targetSize === undefined ? 0 : targetSize - rawSize);
  return Buffer.from(body + trailer(Buffer.byteLength(body)));
};
module.exports = { makePdf };
