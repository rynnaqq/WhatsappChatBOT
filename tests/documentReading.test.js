import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { prepareAttachment, AttachmentUserFacingError } from '../src/services/attachmentService.js';
import { tablePdf, a4ScannedTablePdf, mergedTableDocx } from './fixtures/documents.js';

const ai = { visionEnabled: true, mediaEnabled: true, maxFileMB: 10, maxImageMB: 5, attachmentTransport: 'auto' };
const pdfAttachment = buffer => ({ kind: 'document', fileName: 'ledger.pdf', mimeType: 'application/pdf', buffer });

test('reads every page of an eight-page 4 MB A4 table scan within the document worker deadline', async () => {
  const buffer = a4ScannedTablePdf();
  assert.ok(buffer.length >= 3_500_000 && buffer.length <= 5_000_000);
  const result = await prepareAttachment(pdfAttachment(buffer), { ai });
  const images = result.parts.filter(part => part.type === 'image_url');
  assert.equal(images.length, 8);
  assert.equal(new Set(images.map(part => part.image_url.url)).size, 8);
  assert.equal(result.requiresVision, true);
  const text = result.parts.filter(part => part.type === 'text').map(part => part.text).join('\n');
  for (let pageNumber = 1; pageNumber <= 8; pageNumber += 1) assert.ok(text.includes(`Page ${pageNumber} of 8`));
  for (const part of images) {
    const image = await loadImage(Buffer.from(part.image_url.url.split(',')[1], 'base64'));
    assert.ok(image.width >= 1200);
    assert.ok(Math.max(image.width, image.height) <= 2400);
    assert.ok(image.width * image.height <= 4_000_000);
    const canvas = createCanvas(image.width, image.height);
    try {
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const area = context.getImageData(
        Math.floor(image.width * 1720 / 2480), Math.floor(image.height * 2980 / 3508),
        Math.floor(image.width * 400 / 2480), Math.floor(image.height * 80 / 3508),
      );
      let darkPixels = 0;
      for (let offset = 0; offset < area.data.length; offset += 4) if (area.data[offset] < 100) darkPixels += 1;
      assert.ok(darkPixels > 100, 'The last table row must retain its scanned values.');
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
});

for (const [name, options] of [
  ['digital tables', {}],
  ['scanned tables', { scanned: true }],
  ['mixed text and scan', { mixed: true }],
]) {
  test('automatic PDF reading preserves all pages visually for ' + name, async () => {
    const result = await prepareAttachment(pdfAttachment(tablePdf(options)), { ai });
    const images = result.parts.filter(part => part.type === 'image_url');
    assert.equal(images.length, 2);
    assert.equal(result.requiresVision, true);
    const text = result.parts.filter(part => part.type === 'text').map(part => part.text).join('\n');
    assert.match(text, /Page 1 of 2/);
    assert.match(text, /Page 2 of 2/);
    for (const part of images) {
      assert.equal(part.image_url.detail, 'high');
      assert.match(part.image_url.url, /^data:image\/jpeg;base64,/);
      const image = await loadImage(Buffer.from(part.image_url.url.split(',')[1], 'base64'));
      assert.ok(image.width >= 1200);
      assert.ok(image.height >= 1500);
      assert.ok(image.width * image.height <= 4_000_000);
    }
    assert.equal(result.memoryText.includes('Alpha'), false);
    assert.equal(result.memoryText.includes(images[0].image_url.url), false);
  });
}

test('PDF visual page limits reject incomplete reading instead of silently dropping pages', async () => {
  await assert.rejects(
    prepareAttachment(pdfAttachment(tablePdf({ pages: 21 })), { ai }),
    error => error instanceof AttachmentUserFacingError && /pages|split/i.test(error.message),
  );
});

test('PDF tables retain original native fallback when vision is disabled', async () => {
  const buffer = tablePdf({ mixed: true });
  const result = await prepareAttachment(pdfAttachment(buffer), { ai: { ...ai, visionEnabled: false } });
  const original = result.parts.find(part => part.type === 'file');
  assert.ok(original);
  assert.equal(original.file.file_data, 'data:application/pdf;base64,' + buffer.toString('base64'));
  assert.equal(result.requiresVision, undefined);
});

test('DOCX extraction retains merged-cell structure and row-value associations', async () => {
  const result = await prepareAttachment({
    kind: 'document', fileName: 'ledger.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: mergedTableDocx(),
  }, { ai });
  const text = result.parts[0].text;
  assert.match(text, /Quarterly ledger/);
  assert.match(text, /<t[dh][^>]*colspan=["']2["']/);
  assert.match(text, /<tr[^>]*>[\s\S]*Revenue[\s\S]*123\.40[\s\S]*<\/tr>/);
  assert.match(text, /<tr[^>]*>[\s\S]*Cost[\s\S]*80\.25[\s\S]*<\/tr>/);
  assert.equal(result.memoryText.includes('Revenue'), false);
});

test('legacy DOC contents are read for specific and generic MIME declarations', async () => {
  const buffer = await readFile(new URL('./fixtures/legacy-doc/table.doc', import.meta.url));
  for (const [fileName, mimeType] of [
    ['ledger.DOC', 'application/msword'],
    ['ledger.doc', 'application/octet-stream'],
    ['document', 'application/msword'],
    ['document', 'application/octet-stream'],
  ]) {
    const result = await prepareAttachment({ kind: 'document', buffer, fileName, mimeType }, { ai });
    assert.match(result.parts[0].text, /License\tGPL v3\.0\tLGPL v3\.0\tBSD\tMIT \(X11\)\tApache v2\.0/);
    assert.match(result.memoryText, /application\/msword/);
    assert.equal(result.memoryText.includes('GPL'), false);
  }
});
