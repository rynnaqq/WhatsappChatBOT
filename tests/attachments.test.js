import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync } from 'fflate';

import { prepareAttachment } from '../src/services/attachmentService.js';

const DEFAULT_AI = {
  visionEnabled: true,
  maxImageMB: 5,
  mediaEnabled: true,
  maxFileMB: 10,
};

function attachment(overrides = {}) {
  return {
    kind: 'document',
    buffer: Buffer.from('hello'),
    mimeType: 'text/plain',
    fileName: 'note.txt',
    ...overrides,
  };
}

function zipped(entries) {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [
    name,
    typeof value === 'string' ? Buffer.from(value) : value,
  ])), { level: 0 }));
}

test('image preparation emits a data URL while memory keeps metadata only', async () => {
  assert.equal(typeof prepareAttachment, 'function');
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  const result = await prepareAttachment({
    kind: 'image',
    buffer: bytes,
    mimeType: 'image/png',
    fileName: 'photo.png',
  }, {
    ai: { visionEnabled: true, maxImageMB: 5 },
  });

  assert.deepEqual(result.parts, [{
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,iVBORw==' },
  }]);
  assert.match(result.memoryText, /^\[image sent: photo\.png \(image\/png, 4 bytes\)\]$/);
  assert.equal(result.memoryText.includes('iVBORw'), false);
});

test('image controls are independent from general media controls', async () => {
  const image = attachment({ kind: 'sticker', buffer: Buffer.from('webp'), mimeType: 'image/webp', fileName: 'sticker.webp' });
  await assert.rejects(
    prepareAttachment(image, { ai: { ...DEFAULT_AI, visionEnabled: false, mediaEnabled: true } }),
    (error) => error.code === 'ATTACHMENT_USER_FACING' && error.message.includes('disabled'),
  );
  await assert.rejects(
    prepareAttachment({ ...image, buffer: Buffer.alloc(1050) }, { ai: { ...DEFAULT_AI, maxImageMB: 0.001, maxFileMB: 20 } }),
    (error) => error.code === 'ATTACHMENT_USER_FACING' && error.message.includes('0.001 MB limit'),
  );
});

test('audio, video, and PDF use native file parts and default media settings', async () => {
  const cases = [
    ['audio', 'audio/ogg', 'voice.ogg', Buffer.from('OggS')],
    ['video', 'video/mp4', 'clip.mp4', Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70])],
    ['document', 'application/pdf', 'paper.pdf', Buffer.from('%PDF-1.7\n')],
  ];
  for (const [kind, mimeType, fileName, buffer] of cases) {
    const result = await prepareAttachment({ kind, mimeType, fileName, buffer }, { ai: {} });
    assert.deepEqual(result.parts, [{
      type: 'file',
      file: { filename: fileName, file_data: `data:${mimeType};base64,${buffer.toString('base64')}` },
    }]);
    assert.match(result.memoryText, new RegExp(`^\\[${kind} sent:`));
    assert.equal(result.memoryText.includes(buffer.toString('base64')), false);
  }
});

test('attachment transport selects verified 9Router Gemini parts without duplicating payloads', async () => {
  const cases = [
    ['audio', 'audio/ogg', 'voice.ogg', 'audio_url'],
    ['video', 'video/mp4', 'clip.mp4', 'image_url'],
    ['document', 'application/pdf', 'paper.pdf', 'image_url'],
  ];
  for (const [kind, mimeType, fileName, expectedType] of cases) {
    const buffer = mimeType === 'application/pdf' ? Buffer.from('%PDF-1.7\n') : Buffer.from('media');
    const result = await prepareAttachment({ kind, mimeType, fileName, buffer }, {
      ai: { ...DEFAULT_AI, model: 'ag/gemini-3.8-flash-high', attachmentTransport: 'auto' },
    });
    assert.equal(result.parts.length, 1);
    assert.equal(result.parts[0].type, expectedType);
    assert.equal(result.parts[0][expectedType].url, `data:${mimeType};base64,${buffer.toString('base64')}`);
  }

  const forcedStandard = await prepareAttachment(attachment({
    kind: 'audio', mimeType: 'audio/ogg', fileName: 'voice.ogg', buffer: Buffer.from('audio'),
  }), { ai: { ...DEFAULT_AI, model: 'ag/gemini-3.8-flash-high', attachmentTransport: 'file' } });
  assert.equal(forcedStandard.parts[0].type, 'file');

  const forcedRouter = await prepareAttachment(attachment({
    kind: 'video', mimeType: 'video/webm', fileName: 'clip.webm', buffer: Buffer.from('video'),
  }), { ai: { ...DEFAULT_AI, model: 'other-model', attachmentTransport: '9router-gemini' } });
  assert.equal(forcedRouter.parts[0].type, 'image_url');
});

test('generic Ogg MIME is normalized to a media MIME for audio and document transports', async () => {
  for (const kind of ['audio', 'document']) {
    const result = await prepareAttachment(attachment({ kind, mimeType: 'application/ogg', fileName: 'voice.ogg', buffer: Buffer.from('OggS fixture') }), {
      ai: { ...DEFAULT_AI, model: 'ag/gemini-3.8-flash-high' },
    });
    assert.equal(result.parts[0].type, 'audio_url');
    assert.match(result.parts[0].audio_url.url, /^data:audio\/ogg;base64,/);
    assert.match(result.memoryText, /audio\/ogg/);
  }
  await assert.rejects(prepareAttachment(attachment({ kind: 'audio', mimeType: 'application/ogg', fileName: 'voice.ogg', buffer: Buffer.from('not Ogg') }), { ai: DEFAULT_AI }),
    (error) => error.code === 'ATTACHMENT_USER_FACING' && /file type|Ogg/i.test(error.message));
});

test('document transport routes image, audio, and video by MIME while retaining document metadata', async () => {
  const image = await prepareAttachment(attachment({
    kind: 'document', mimeType: 'image/png', fileName: 'photo.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  }), { ai: DEFAULT_AI });
  assert.equal(image.parts[0].type, 'image_url');
  assert.match(image.memoryText, /^\[document sent:/);

  for (const [mimeType, fileName] of [['audio/flac', 'track.flac'], ['video/webm', 'clip.webm']]) {
    const result = await prepareAttachment(attachment({ kind: 'document', mimeType, fileName }), { ai: DEFAULT_AI });
    assert.equal(result.parts[0].type, 'file');
    assert.match(result.memoryText, /^\[document sent:/);
  }

  await assert.rejects(
    prepareAttachment(attachment({ kind: 'document', mimeType: 'image/png', fileName: 'photo.png' }), { ai: { ...DEFAULT_AI, visionEnabled: false } }),
    (error) => error.code === 'ATTACHMENT_USER_FACING' && /image.*disabled/i.test(error.message),
  );
});

test('general media controls reject disabled and oversized files before encoding', async () => {
  const audio = attachment({ kind: 'audio', mimeType: 'audio/ogg', fileName: 'voice.ogg', buffer: Buffer.from('OggS') });
  await assert.rejects(
    prepareAttachment(audio, { ai: { ...DEFAULT_AI, mediaEnabled: false } }),
    (error) => error.code === 'ATTACHMENT_USER_FACING' && error.message.includes('disabled'),
  );
  await assert.rejects(
    prepareAttachment({ ...audio, buffer: Buffer.alloc(1050) }, { ai: { ...DEFAULT_AI, maxFileMB: 0.001 } }),
    (error) => error.code === 'ATTACHMENT_USER_FACING' && error.message.includes('0.001 MB limit'),
  );
});

test('empty buffers and malformed MIME types are rejected safely', async () => {
  for (const bad of [
    attachment({ buffer: Buffer.alloc(0) }),
    attachment({ buffer: new Uint8Array([1]) }),
    attachment({ mimeType: '' }),
    attachment({ mimeType: 'not-a-mime' }),
  ]) {
    await assert.rejects(
      prepareAttachment(bad, { ai: DEFAULT_AI }),
      (error) => error.code === 'ATTACHMENT_USER_FACING',
    );
  }
});

test('plain text is BOM-aware, bounded, explicitly truncated, and excluded from memory', async () => {
  const text = `${'x'.repeat(60_010)} END`;
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const result = await prepareAttachment(attachment({
    buffer: utf16,
    mimeType: 'text/plain',
    fileName: '..\\folder/long.txt',
  }), { ai: DEFAULT_AI });

  assert.equal(result.parts.length, 1);
  assert.equal(result.parts[0].type, 'text');
  assert.match(result.parts[0].text, /^Contents of long\.txt:\n/);
  assert.match(result.parts[0].text, /\n\[Content truncated to 60000 characters\.\]$/);
  assert.equal(result.parts[0].text.includes('END'), false);
  assert.equal(result.memoryText, `[document sent: long.txt (text/plain, ${utf16.byteLength} bytes)]`);
  assert.equal(result.memoryText.includes('xxxx'), false);
});

test('plain text rejects malformed UTF-8 and embedded binary controls', async () => {
  for (const buffer of [Buffer.from([0xc3, 0x28]), Buffer.from('visible\0hidden')]) {
    await assert.rejects(
      prepareAttachment(attachment({ buffer, mimeType: 'text/plain', fileName: 'renamed.txt' }), { ai: DEFAULT_AI }),
      (error) => error.code === 'ATTACHMENT_USER_FACING' && /text|encoding|binary/i.test(error.message),
    );
  }
});

test('generic ZIP produces a bounded filename inventory without file contents', async () => {
  const buffer = zipped({
    'docs/readme.txt': 'TOP SECRET CONTENT',
    'images/photo.png': Buffer.from([1, 2, 3]),
    'empty/': Buffer.alloc(0),
  });
  const result = await prepareAttachment(attachment({
    buffer,
    mimeType: 'application/zip',
    fileName: 'bundle.zip',
  }), { ai: DEFAULT_AI });

  assert.equal(result.parts[0].type, 'text');
  assert.match(result.parts[0].text, /docs\/readme\.txt/);
  assert.match(result.parts[0].text, /images\/photo\.png/);
  assert.equal(result.parts[0].text.includes('TOP SECRET CONTENT'), false);
  assert.equal(result.memoryText.includes('readme'), false);

  const longNames = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [
    `${String(index).padStart(3, '0')}-${'n'.repeat(700)}.txt`,
    '',
  ]));
  const bounded = await prepareAttachment(attachment({
    buffer: zipped(longNames),
    mimeType: 'application/zip',
    fileName: 'many.zip',
  }), { ai: DEFAULT_AI });
  assert.match(bounded.parts[0].text, /\n\[Archive inventory truncated to 60000 characters\.\]$/);
  assert.equal(bounded.parts[0].text.length < 60_100, true);
});

test('ZIP traversal, excessive entries, corrupt archives, and encryption flags fail safely', async () => {
  const traversal = zipped({ '../escape.txt': 'x' });
  const tooMany = zipped(Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`f${index}.txt`, ''])));
  const corrupt = Buffer.from('PK\x03\x04broken');
  const encrypted = Buffer.from(zipped({ 'safe.txt': 'x' }));
  const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  const missingLocalFile = Buffer.from(zipped({ 'safe.txt': 'x' }));
  missingLocalFile.writeUInt32LE(0, 0);
  const inflatedLimit = Buffer.from(zipped({ 'safe.txt': 'x' }));
  const inflatedCentral = inflatedLimit.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  inflatedLimit.writeUInt32LE((32 * 1024 * 1024) + 1, inflatedCentral + 24);

  for (const buffer of [traversal, tooMany, corrupt, encrypted, missingLocalFile, inflatedLimit]) {
    await assert.rejects(
      prepareAttachment(attachment({ buffer, mimeType: 'application/zip', fileName: 'bad.zip' }), { ai: DEFAULT_AI }),
      (error) => error.code === 'ATTACHMENT_USER_FACING',
    );
  }
});

test('legacy Office, executable, unknown binary, and spoofed PDF formats are rejected clearly', async () => {
  const cases = [
    ['old.doc', 'application/msword', Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
    ['program.exe', 'application/octet-stream', Buffer.from('MZ')],
    ['blob.bin', 'application/octet-stream', Buffer.from([1, 2, 3])],
    ['fake.pdf', 'application/pdf', Buffer.from('not pdf')],
  ];
  for (const [fileName, mimeType, buffer] of cases) {
    await assert.rejects(
      prepareAttachment(attachment({ fileName, mimeType, buffer }), { ai: DEFAULT_AI }),
      (error) => error.code === 'ATTACHMENT_USER_FACING' && error.message.length > 10,
    );
  }
});

test('an already-aborted operation stops before attachment work starts', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('stopped', 'AbortError'));
  await assert.rejects(
    prepareAttachment(attachment(), { ai: DEFAULT_AI, signal: controller.signal }),
    (error) => error.name === 'AbortError',
  );
});

test('DOCX, XLSX, PPTX, ODT, ODS, and ODP are parsed in an isolated worker', async () => {
  const fixtures = officeFixtures();
  for (const fixture of fixtures) {
    const result = await prepareAttachment(attachment(fixture), { ai: DEFAULT_AI });
    assert.equal(result.parts[0].type, 'text', fixture.fileName);
    assert.match(result.parts[0].text, new RegExp(fixture.expected), fixture.fileName);
    assert.equal(result.memoryText.includes(fixture.expected), false, fixture.fileName);
  }
});

test('Office detection accepts validated generic MIME and specific MIME without an Office extension', async () => {
  const docx = officeFixtures()[0];
  for (const candidate of [
    { ...docx, mimeType: 'application/octet-stream' },
    { ...docx, mimeType: 'application/zip' },
    { ...docx, mimeType: 'application/x-zip-compressed' },
    { ...docx, fileName: 'document.bin' },
  ]) {
    const result = await prepareAttachment(attachment(candidate), { ai: DEFAULT_AI });
    assert.match(result.parts[0].text, /Hello DOCX/);
    assert.match(result.memoryText, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  }

  await assert.rejects(
    prepareAttachment(attachment({
      ...docx,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }), { ai: DEFAULT_AI }),
    (error) => error.code === 'ATTACHMENT_USER_FACING' && /match|type/i.test(error.message),
  );
});

test('Office parsing limits active workers to two and releases slots after worker exit', async () => {
  const docx = officeFixtures()[0];
  const first = prepareAttachment(attachment(docx), { ai: DEFAULT_AI });
  const second = prepareAttachment(attachment(docx), { ai: DEFAULT_AI });

  await assert.rejects(
    prepareAttachment(attachment(docx), { ai: DEFAULT_AI }),
    (error) => error.code === 'ATTACHMENT_USER_FACING' && /busy|retry/i.test(error.message),
  );
  const initial = await Promise.all([first, second]);
  assert.equal(initial.every((result) => result.parts[0].text.includes('Hello DOCX')), true);

  const afterRelease = await prepareAttachment(attachment(docx), { ai: DEFAULT_AI });
  assert.match(afterRelease.parts[0].text, /Hello DOCX/);
});

test('office parsing honors cancellation and corrupt or spoofed containers fail safely', async () => {
  const fixture = officeFixtures()[0];
  const controller = new AbortController();
  const pending = prepareAttachment(attachment(fixture), { ai: DEFAULT_AI, signal: controller.signal });
  controller.abort(new DOMException('stopped', 'AbortError'));
  await assert.rejects(pending, (error) => error.name === 'AbortError');

  for (const bad of [
    { ...fixture, buffer: zipped({ 'word/document.xml': '<bad>' }) },
    { ...fixture, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    {
      fileName: 'spoofed.odt',
      mimeType: 'application/vnd.oasis.opendocument.text',
      buffer: zipped({
        mimetype: 'application/x-not-odf',
        'META-INF/manifest.xml': '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>',
        'content.xml': '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:body><office:text/></office:body></office:document-content>',
      }),
    },
  ]) {
    await assert.rejects(
      prepareAttachment(attachment(bad), { ai: DEFAULT_AI }),
      (error) => error.code === 'ATTACHMENT_USER_FACING',
    );
  }
});

function officeFixtures() {
  const contentTypes = (overrides) => `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${overrides}</Types>`;
  const rootRels = (target, type) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${type}" Target="${target}"/></Relationships>`;
  const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
  const odfManifest = (mime) => `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  const odf = (mime, body) => zipped({
    mimetype: mime,
    'META-INF/manifest.xml': odfManifest(mime),
    'content.xml': `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body>${body}</office:body></office:document-content>`,
  });

  return [
    {
      fileName: 'sample.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      expected: 'Hello DOCX',
      buffer: zipped({
        '[Content_Types].xml': contentTypes('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),
        '_rels/.rels': rootRels('word/document.xml', officeRel),
        'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>',
      }),
    },
    {
      fileName: 'sample.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      expected: 'Hello XLSX',
      buffer: zipped({
        '[Content_Types].xml': contentTypes('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'),
        '_rels/.rels': rootRels('xl/workbook.xml', officeRel),
        'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': rootRels('worksheets/sheet1.xml', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'),
        'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello XLSX</t></is></c></row></sheetData></worksheet>',
      }),
    },
    {
      fileName: 'sample.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      expected: 'Hello PPTX',
      buffer: zipped({
        '[Content_Types].xml': contentTypes('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'),
        '_rels/.rels': rootRels('ppt/presentation.xml', officeRel),
        'ppt/presentation.xml': '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
        'ppt/_rels/presentation.xml.rels': rootRels('slides/slide1.xml', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'),
        'ppt/slides/slide1.xml': '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Hello PPTX</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
      }),
    },
    {
      fileName: 'sample.odt', mimeType: 'application/vnd.oasis.opendocument.text', expected: 'Hello ODT',
      buffer: odf('application/vnd.oasis.opendocument.text', '<office:text><text:p>Hello ODT</text:p></office:text>'),
    },
    {
      fileName: 'sample.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet', expected: 'Hello ODS',
      buffer: odf('application/vnd.oasis.opendocument.spreadsheet', '<office:spreadsheet><table:table table:name="Sheet1"><table:table-row><table:table-cell office:value-type="string"><text:p>Hello ODS</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>'),
    },
    {
      fileName: 'sample.odp', mimeType: 'application/vnd.oasis.opendocument.presentation', expected: 'Hello ODP',
      buffer: odf('application/vnd.oasis.opendocument.presentation', '<office:presentation><draw:page draw:name="Slide 1"><draw:frame><draw:text-box><text:p>Hello ODP</text:p></draw:text-box></draw:frame></draw:page></office:presentation>'),
    },
  ];
}
