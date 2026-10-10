import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { OfficeParser } from 'officeparser';
import { readPdfDocument } from '../src/services/pdfDocumentReader.js';
import { tablePdf } from './fixtures/documents.js';

async function parsePdf(buffer) {
  return OfficeParser.parseOffice(buffer, {
    fileType: 'pdf',
    abortSignal: null,
    extractAttachments: false,
    includeRawContent: false,
    ocr: false,
    ignoreComments: true,
    pdfParserConfig: { separateProcess: false },
  });
}

function pdf(objects) {
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((body, index) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), bytes, Buffer.from('\nendobj\n')]);
    offsets.push(length);
    chunks.push(object);
    length += object.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  return Buffer.concat([...chunks, Buffer.from(xref)]);
}

function pdfStream(bytes, dictionary = '') {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`),
    bytes,
    Buffer.from('\nendstream'),
  ]);
}

function plainTextPdf({ font = 'Helvetica', text = 'A straightforward paragraph with enough text for direct extraction.' } = {}) {
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    `<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
  ];
  const content = `BT /F1 14 Tf 1 0 0 1 72 720 Tm (${text}) Tj ET`;
  bodies.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  return pdf(bodies);
}

function oversizedImagePdf() {
  const width = 4097;
  const height = 4097;
  const image = deflateSync(Buffer.alloc(width * height));
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    pdfStream(Buffer.from('q 600 0 0 700 6 46 cm /Im1 Do Q')),
    pdfStream(image, `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`),
  ]);
}

function standardScanPdf() {
  const width = 2480;
  const height = 3508;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#111111';
  context.font = 'bold 72px sans-serif';
  context.fillText('300 DPI A4 scan', 180, 250);
  context.font = '48px sans-serif';
  context.fillText('Invoice total: 123.45', 180, 380);
  const image = canvas.toBuffer('image/jpeg', 88);
  canvas.width = 0;
  canvas.height = 0;
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    pdfStream(Buffer.from('q 612 0 0 792 0 0 cm /Im1 Do Q')),
    pdfStream(image, `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`),
  ]);
}

test('keeps ordinary text PDFs text-only even when visual output is allowed', async () => {
  const buffer = plainTextPdf();
  const result = await readPdfDocument(buffer, await parsePdf(buffer), { includeVisuals: true });

  assert.equal(result.requiresNative, false);
  assert.deepEqual(result.visualPages, []);
  assert.match(result.text, /Page 1 of 1[\s\S]*straightforward paragraph/);
});

test('preserves page-labelled Markdown tables and requests the original PDF without visual rendering', async () => {
  const buffer = tablePdf();
  const result = await readPdfDocument(buffer, await parsePdf(buffer));

  assert.equal(result.pageCount, 2);
  assert.equal(result.requiresNative, true);
  assert.deepEqual(result.visualPages, []);
  assert.match(result.text, /Page 1 of 2[\s\S]*\| Item \| Qty \| Total \|/);
  assert.match(result.text, /Page 2 of 2[\s\S]*\| Gamma \| 13 \| 130 \|/);
  assert.ok(result.text.includes('Page 1 of 2\n\n---'));
  assert.ok(result.text.includes('| Alpha | 7 | 70 |\n| Beta | 9 | 90 |\n\nPage 2 of 2'));
  assert.equal(result.text.includes('\\n'), false);
  assert.equal(result.truncated, false);
});

test('loads bundled standard fonts through real filesystem paths', async () => {
  const buffer = plainTextPdf({ font: 'Courier', text: 'Short page' });
  const ast = await parsePdf(buffer);
  const fileSystem = process.getBuiltinModule('fs/promises');
  const originalReadFile = fileSystem.readFile;
  const attempts = [];
  const successfulReads = [];
  fileSystem.readFile = async function trackedReadFile(path, ...args) {
    const isStandardFont = String(path).includes('standard_fonts');
    if (isStandardFont) attempts.push(path);
    const bytes = await originalReadFile.call(this, path, ...args);
    if (isStandardFont) successfulReads.push(path);
    return bytes;
  };

  try {
    const result = await readPdfDocument(buffer, ast, { includeVisuals: true });
    assert.equal(result.visualPages.length, 1);
  } finally {
    fileSystem.readFile = originalReadFile;
  }

  assert.ok(attempts.length > 0);
  assert.equal(attempts.some(path => String(path).startsWith('file:')), false);
  assert.equal(successfulReads.length, attempts.length);
});

test('renders every page as a bounded JPEG when one page contains a scan', async () => {
  const buffer = tablePdf({ mixed: true });
  const result = await readPdfDocument(buffer, await parsePdf(buffer), { includeVisuals: true });

  assert.equal(result.requiresNative, false);
  assert.deepEqual(result.visualPages.map(page => page.pageNumber), [1, 2]);
  for (const page of result.visualPages) {
    assert.deepEqual(Array.from(page.bytes.subarray(0, 3)), [0xff, 0xd8, 0xff]);
    const image = await loadImage(page.bytes);
    assert.ok(Math.max(image.width, image.height) <= 2400);
    assert.ok(image.width * image.height <= 4_000_000);
  }
});

test('accepts a standard 300 DPI A4 scan and downsizes its final page image', async () => {
  const buffer = standardScanPdf();
  const result = await readPdfDocument(buffer, await parsePdf(buffer), { includeVisuals: true });

  assert.equal(result.visualPages.length, 1);
  const image = await loadImage(result.visualPages[0].bytes);
  assert.ok(Math.max(image.width, image.height) <= 2400);
  assert.ok(image.width * image.height <= 4_000_000);
  assert.ok(image.width >= 1200);
});

test('caps extracted text and reports truncation', async () => {
  const buffer = tablePdf();
  const result = await readPdfDocument(buffer, await parsePdf(buffer), { maxChars: 40 });

  assert.equal(result.text.length, 40);
  assert.equal(result.truncated, true);
});

test('rejects visual PDFs over the all-page rendering limit with a typed error', async () => {
  const buffer = tablePdf({ pages: 21 });

  await assert.rejects(
    readPdfDocument(buffer, await parsePdf(buffer), { includeVisuals: true }),
    error => error?.code === 'PDF_VISUAL_PAGE_LIMIT' && !String(error.message).includes('%PDF'),
  );
});

test('rejects invalid content limits without exposing document contents', async () => {
  const buffer = tablePdf();

  await assert.rejects(
    readPdfDocument(buffer, await parsePdf(buffer), { maxChars: -1 }),
    error => error?.code === 'PDF_CONTENT_LIMIT' && !String(error.message).includes('Ledger'),
  );
});

test('rejects parser warnings that mean PDF page content was omitted', async () => {
  const buffer = tablePdf();
  const ast = await parsePdf(buffer);
  ast.warnings.push({
    type: 'warning',
    code: 'PDF_CONTENT_LIMIT_EXCEEDED',
    message: 'omitted private page contents',
  });

  await assert.rejects(
    readPdfDocument(buffer, ast),
    error => error?.code === 'PDF_CONTENT_LIMIT' && !String(error.message).includes('private'),
  );
});

test('rejects embedded image canvases over the internal pixel limit before native allocation', async () => {
  const buffer = oversizedImagePdf();
  const ast = await parsePdf(buffer);

  await assert.rejects(
    readPdfDocument(buffer, ast, { includeVisuals: true }),
    error => error?.code === 'PDF_CONTENT_LIMIT',
  );
});
