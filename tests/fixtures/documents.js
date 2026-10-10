import { createCanvas } from '@napi-rs/canvas';
import { zipSync } from 'fflate';

function stream(bytes, dictionary = '') {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'binary');
  return Buffer.concat([
    Buffer.from('<< ' + dictionary + ' /Length ' + data.length + ' >>\nstream\n', 'binary'),
    data, Buffer.from('\nendstream', 'binary'),
  ]);
}

function pdf(objects) {
  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'binary')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((body, index) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'binary');
    const object = Buffer.concat([Buffer.from((index + 1) + ' 0 obj\n'), bytes, Buffer.from('\nendobj\n')]);
    offsets.push(length); chunks.push(object); length += object.length;
  });
  const xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n'
    + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')
    + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + length + '\n%%EOF\n';
  return Buffer.concat([...chunks, Buffer.from(xref)]);
}

function rowsForPage(index) {
  return index === 0
    ? [['Item', 'Qty', 'Total'], ['Alpha', '7', '70'], ['Beta', '9', '90']]
    : [['Item', 'Qty', 'Total'], ['Gamma', '13', '130'], ['Delta', '17', '170']];
}

function scanImage(index) {
  const canvas = createCanvas(900, 1160);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 900, 1160);
  context.fillStyle = '#000'; context.font = 'bold 32px sans-serif';
  context.fillText('Ledger page ' + (index + 1), 60, 95);
  context.font = '28px sans-serif'; context.lineWidth = 2;
  rowsForPage(index).forEach((row, rowIndex) => {
    const y = 155 + rowIndex * 76;
    row.forEach((cell, colIndex) => {
      const x = [60, 360, 610][colIndex];
      context.strokeRect(x, y, [300, 250, 230][colIndex], 76);
      context.fillText(cell, x + 15, y + 48);
    });
  });
  const bytes = canvas.toBuffer('image/jpeg', 96);
  canvas.width = 0; canvas.height = 0;
  return bytes;
}

export function tablePdf({ pages = 2, scanned = false, mixed = false } = {}) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let index = 0; index < pages; index++) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    const isScan = scanned || (mixed && index > 0);
    const imageId = pageId + 2;
    const resources = '/Font << /F1 3 0 R >>' + (isScan ? ' /XObject << /Im1 ' + imageId + ' 0 R >>' : '');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ' + resources + ' >> /Contents ' + contentId + ' 0 R >>');
    let content = 'BT /F1 18 Tf 1 0 0 1 40 755 Tm (Ledger ' + (index + 1) + ') Tj ET\n';
    if (isScan) content += 'q 580 0 0 748 16 8 cm /Im1 Do Q\n';
    else {
      rowsForPage(index).forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
        content += 'BT /F1 14 Tf 1 0 0 1 ' + [72, 265, 425][colIndex] + ' ' + (690 - rowIndex * 36) + ' Tm (' + cell + ') Tj ET\n';
      }));
    }
    objects.push(stream(content));
    if (isScan) objects.push(stream(scanImage(index), '/Type /XObject /Subtype /Image /Width 900 /Height 1160 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'));
    kids.push(pageId + ' 0 R');
  }
  objects[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages + ' >>';
  return pdf(objects);
}

export function mergedTableDocx() {
  const entries = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly ledger</w:t></w:r></w:p><w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Totals</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Revenue</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>123.40</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Cost</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>80.25</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, Buffer.from(value)]))));
}
