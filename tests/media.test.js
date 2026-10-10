import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadImageMessage, downloadIncomingMedia, MediaUserFacingError } from '../src/bot/mediaService.js';

const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };

function imageMessage({
  mimeType = 'image/png',
  fileLength,
  chunks,
  url = 'https://mmg.whatsapp.net/media',
  directPath,
}) {
  return {
    key: { id: 'media-id', remoteJid: 'person@s.whatsapp.net', fromMe: false },
    message: { imageMessage: { mimetype: mimeType, fileLength, ...(url === undefined ? {} : { url }), ...(directPath === undefined ? {} : { directPath }) } },
    async downloadMediaMessage(_message, type, options, context) {
      assert.equal(type, 'stream');
      assert.equal(options.options.signal instanceof AbortSignal, true);
      assert.equal(typeof context.reuploadRequest, 'function');
      return (async function* stream() {
        for (const chunk of chunks) yield chunk;
      }());
    },
    async updateMediaMessage() {},
  };
}

function incomingMediaMessage({
  messageKey,
  mimeType,
  bytes,
  fileLength = bytes.length,
  fileName,
  wrapper,
  url = 'https://mmg.whatsapp.net/media',
  directPath,
}) {
  const media = {
    mimetype: mimeType,
    fileLength,
    ...(fileName === undefined ? {} : { fileName }),
    ...(url === undefined ? {} : { url }),
    ...(directPath === undefined ? {} : { directPath }),
  };
  let payload = { [messageKey]: media };
  if (wrapper) payload = { [wrapper]: { message: payload } };
  return {
    key: { id: 'incoming-media-id', remoteJid: 'person@s.whatsapp.net', fromMe: false },
    message: payload,
    async downloadMediaMessage(_message, type, options, context) {
      assert.equal(type, 'stream');
      assert.equal(options.options.signal instanceof AbortSignal, true);
      assert.equal(typeof context.reuploadRequest, 'function');
      return (async function* stream() { yield bytes; }());
    },
    async updateMediaMessage() {},
  };
}

test('declared oversized images are rejected before opening the download stream', async () => {
  let downloaded = false;
  const msg = imageMessage({ fileLength: { low: 11, high: 0, unsigned: true }, chunks: [] });
  msg.downloadMediaMessage = async () => { downloaded = true; throw new Error('should not run'); };

  await assert.rejects(
    downloadImageMessage(msg, msg, { maxBytes: 10, logger }),
    (error) => error instanceof MediaUserFacingError && error.code === 'MEDIA_USER_FACING',
  );
  assert.equal(downloaded, false);
});

test('streaming size enforcement aborts before buffering data beyond the limit', async () => {
  const msg = imageMessage({ fileLength: 0, chunks: [Buffer.alloc(6), Buffer.alloc(6)] });
  await assert.rejects(
    downloadImageMessage(msg, msg, { maxBytes: 10, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('too large'),
  );
});

test('download acquisition timeout aborts the request and returns a typed safe error', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  let requestSignal;
  const msg = imageMessage({ mimeType: 'image/jpeg', fileLength: bytes.length, chunks: [bytes] });
  msg.downloadMediaMessage = async (_message, _type, options) => {
    requestSignal = options.options.signal;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return (async function* stream() { yield bytes; }());
  };

  await assert.rejects(
    downloadImageMessage(msg, msg, { maxBytes: 100, timeoutMs: 10, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('timed out'),
  );
  assert.equal(requestSignal.aborted, true);
});

test('stream timeout destroys a stalled stream and unblocks the caller', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  let destroyed = false;
  const msg = imageMessage({ mimeType: 'image/jpeg', fileLength: bytes.length, chunks: [] });
  msg.downloadMediaMessage = async () => ({
    [Symbol.asyncIterator]() { return this; },
    next: async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { done: false, value: bytes };
    },
    destroy() { destroyed = true; },
    async return() { return { done: true }; },
  });

  await assert.rejects(
    downloadImageMessage(msg, msg, { maxBytes: 100, timeoutMs: 10, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('timed out'),
  );
  assert.equal(destroyed, true);
});

test('untrusted media URLs and unsafe direct paths are rejected before download dispatch', async () => {
  const unsafeReferences = [
    { url: 'http://mmg.whatsapp.net/media' },
    { url: 'https://127.0.0.1/media' },
    { url: 'https://[::1]/media' },
    { url: 'https://user:pass@mmg.whatsapp.net/media' },
    { url: 'https://mmg.whatsapp.net:444/media' },
    { url: 'https://evil.example/media' },
    { url: 'https://mmg.whatsapp.net\\@127.0.0.1/media' },
    { url: undefined, directPath: '//evil.example/media' },
    { url: undefined, directPath: '/\\evil.example/media' },
    { url: undefined, directPath: 'relative/media' },
  ];
  for (const reference of unsafeReferences) {
    let downloaded = false;
    const msg = imageMessage({
      ...reference,
      mimeType: 'image/jpeg',
      fileLength: 4,
      chunks: [Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    });
    msg.downloadMediaMessage = async () => { downloaded = true; throw new Error('must not dispatch'); };
    await assert.rejects(
      downloadImageMessage(msg, msg, { maxBytes: 100, logger }),
      (error) => error instanceof MediaUserFacingError && error.message.includes('trusted WhatsApp'),
    );
    assert.equal(downloaded, false);
  }
});

test('the dispatcher blocks an untrusted redirected dispatch path', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  let redirectRejected = false;
  const msg = imageMessage({ mimeType: 'image/jpeg', fileLength: bytes.length, chunks: [bytes] });
  msg.downloadMediaMessage = async (_message, _type, options) => {
    assert.ok(options.options.dispatcher);
    try {
      options.options.dispatcher.dispatch({ origin: 'https://127.0.0.1', path: '/secret', method: 'GET' }, {});
    } catch {
      redirectRejected = true;
    }
    return (async function* stream() { yield bytes; }());
  };

  await downloadImageMessage(msg, msg, { maxBytes: 100, logger });
  assert.equal(redirectRejected, true);
});

test('reuploaded media references are validated before retry dispatch', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const msg = imageMessage({ mimeType: 'image/jpeg', fileLength: bytes.length, chunks: [bytes] });
  msg.updateMediaMessage = async () => imageMessage({
    mimeType: 'image/jpeg',
    fileLength: bytes.length,
    chunks: [bytes],
    url: 'https://127.0.0.1/private',
  });
  msg.downloadMediaMessage = async (_message, _type, _options, context) => {
    await context.reuploadRequest(msg);
    return (async function* stream() { yield bytes; }());
  };

  await assert.rejects(
    downloadImageMessage(msg, msg, { maxBytes: 100, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('trusted WhatsApp'),
  );
});

test('timeout destroys the private dispatcher to abort its underlying request', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  let dispatcherDestroyed = false;
  const msg = imageMessage({ mimeType: 'image/jpeg', fileLength: bytes.length, chunks: [bytes] });
  msg.downloadMediaMessage = async (_message, _type, options) => {
    const originalDestroy = options.options.dispatcher.destroy.bind(options.options.dispatcher);
    options.options.dispatcher.destroy = (...args) => {
      dispatcherDestroyed = true;
      return originalDestroy(...args);
    };
    await new Promise((resolve) => setTimeout(resolve, 100));
    return (async function* stream() { yield bytes; }());
  };

  await assert.rejects(
    downloadImageMessage(msg, msg, { maxBytes: 100, timeoutMs: 10, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('timed out'),
  );
  assert.equal(dispatcherDestroyed, true);
});

test('the media downloader receives a silent dependency logger', async () => {
  const silent = { trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return this; } };
  const appLogger = { child(_bindings, options) { assert.equal(options.level, 'silent'); return silent; } };
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const msg = imageMessage({ mimeType: 'image/jpeg', fileLength: bytes.length, chunks: [bytes] });
  const original = msg.downloadMediaMessage;
  msg.downloadMediaMessage = async (...args) => {
    assert.equal(args[3].logger, silent);
    return original.apply(msg, args);
  };

  await downloadImageMessage(msg, msg, { maxBytes: 100, logger: appLogger });
});

test('PNG, JPEG, GIF, and WebP signatures preserve their compatible MIME type', async () => {
  const fixtures = [
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['image/gif', Buffer.from('GIF89a', 'ascii')],
    ['image/webp', Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')])],
  ];
  for (const [mimeType, bytes] of fixtures) {
    const msg = imageMessage({ mimeType, fileLength: bytes.length, chunks: [bytes] });
    const result = await downloadImageMessage(msg, msg, { maxBytes: 100, logger });
    assert.equal(result.mimeType, mimeType);
    assert.deepEqual(result.buffer, bytes);
  }
});

test('spoofed or unsupported content is rejected instead of being mislabeled as JPEG', async () => {
  const msg = imageMessage({ mimeType: 'image/jpeg', fileLength: 8, chunks: [Buffer.from('notimage')] });
  await assert.rejects(
    downloadImageMessage(msg, msg, { maxBytes: 100, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('supported image'),
  );

  const mismatch = imageMessage({
    mimeType: 'image/jpeg',
    fileLength: 8,
    chunks: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  });
  await assert.rejects(
    downloadImageMessage(mismatch, mismatch, { maxBytes: 100, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('type does not match'),
  );
});

test('generic downloads return normalized attachments for every supported incoming media kind', async () => {
  const fixtures = [
    ['stickerMessage', 'image/webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]), 'sticker'],
    ['audioMessage', 'audio/ogg; codecs=opus', Buffer.from('OggSvoice'), 'audio'],
    ['videoMessage', 'video/mp4', Buffer.from('\0\0\0\x18ftypisomvideo', 'binary'), 'video'],
    ['ptvMessage', 'video/mp4', Buffer.from('\0\0\0\x18ftypisomvideo', 'binary'), 'video'],
    ['documentMessage', 'application/pdf', Buffer.from('%PDF-1.7\nfile'), 'document'],
  ];

  for (const [messageKey, mimeType, bytes, kind] of fixtures) {
    const msg = incomingMediaMessage({ messageKey, mimeType, bytes });
    const result = await downloadIncomingMedia(msg, msg, { maxBytes: 1_000, logger });
    assert.equal(result.kind, kind);
    assert.deepEqual(result.buffer, bytes);
    assert.equal(result.mimeType, mimeType.split(';')[0]);
    assert.equal(typeof result.fileName, 'string');
    assert.equal(result.fileName.includes('/') || result.fileName.includes('\\'), false);
  }
});

test('document-with-caption wrappers are unwrapped and filenames are reduced to safe metadata', async () => {
  const bytes = Buffer.from('%PDF-1.7\nfile');
  const msg = incomingMediaMessage({
    messageKey: 'documentMessage',
    wrapper: 'documentWithCaptionMessage',
    mimeType: 'application/pdf',
    bytes,
    fileName: '../reports/quarter\u0000-one.pdf',
  });

  const result = await downloadIncomingMedia(msg, msg, { maxBytes: 1_000, logger });

  assert.equal(result.kind, 'document');
  assert.equal(result.fileName, 'quarter-one.pdf');
});

test('generic downloads reject declared and streamed oversized documents before provider processing', async () => {
  const bytes = Buffer.from('%PDF-1.7\nfile');
  const declared = incomingMediaMessage({
    messageKey: 'documentMessage', mimeType: 'application/pdf', bytes, fileLength: 101,
  });
  let declaredDownload = false;
  declared.downloadMediaMessage = async () => { declaredDownload = true; throw new Error('must not download'); };
  await assert.rejects(
    downloadIncomingMedia(declared, declared, { maxBytes: 100, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('too large'),
  );
  assert.equal(declaredDownload, false);

  const streamed = incomingMediaMessage({
    messageKey: 'documentMessage', mimeType: 'application/pdf', bytes, fileLength: 0,
  });
  streamed.downloadMediaMessage = async () => (async function* stream() {
    yield Buffer.alloc(60);
    yield Buffer.alloc(60);
  }());
  await assert.rejects(
    downloadIncomingMedia(streamed, streamed, { maxBytes: 100, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('too large'),
  );
});

test('document and audio downloads preserve trusted-host and refreshed-reference validation', async () => {
  const document = incomingMediaMessage({
    messageKey: 'documentMessage',
    mimeType: 'application/pdf',
    bytes: Buffer.from('%PDF-1.7\nfile'),
    url: 'https://127.0.0.1/private',
  });
  let documentDownloaded = false;
  document.downloadMediaMessage = async () => { documentDownloaded = true; throw new Error('must not download'); };
  await assert.rejects(
    downloadIncomingMedia(document, document, { maxBytes: 1_000, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('trusted WhatsApp'),
  );
  assert.equal(documentDownloaded, false);

  const audioBytes = Buffer.from('OggSvoice');
  const audio = incomingMediaMessage({ messageKey: 'audioMessage', mimeType: 'audio/ogg', bytes: audioBytes });
  audio.updateMediaMessage = async () => incomingMediaMessage({
    messageKey: 'audioMessage',
    mimeType: 'audio/ogg',
    bytes: audioBytes,
    url: 'https://evil.example/private',
  });
  audio.downloadMediaMessage = async (_message, _type, _options, context) => {
    await context.reuploadRequest(audio);
    return (async function* stream() { yield audioBytes; }());
  };
  await assert.rejects(
    downloadIncomingMedia(audio, audio, { maxBytes: 1_000, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('trusted WhatsApp'),
  );
});

test('generic downloads reject known MIME-family spoofing but allow octet-stream and OOXML ZIP documents', async () => {
  const spoofedAudio = incomingMediaMessage({
    messageKey: 'audioMessage',
    mimeType: 'audio/ogg',
    bytes: Buffer.from('%PDF-1.7\nfile'),
  });
  await assert.rejects(
    downloadIncomingMedia(spoofedAudio, spoofedAudio, { maxBytes: 1_000, logger }),
    (error) => error instanceof MediaUserFacingError && error.message.includes('type does not match'),
  );

  const zipBytes = Buffer.from('PK\x03\x04office', 'binary');
  for (const [mimeType, expectedMime] of [
    ['application/octet-stream', 'application/zip'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ]) {
    const document = incomingMediaMessage({
      messageKey: 'documentMessage', mimeType, bytes: zipBytes, fileName: 'report.docx',
    });
    const result = await downloadIncomingMedia(document, document, { maxBytes: 1_000, logger });
    assert.equal(result.kind, 'document');
    assert.equal(result.mimeType, expectedMime);
    assert.deepEqual(result.buffer, zipBytes);
  }
});

test('octet-stream documents expose a known MIME detected from their bytes', async () => {
  const fixtures = [
    [Buffer.from('%PDF-1.7\nfile'), 'application/pdf'],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    [Buffer.from('fLaCaudio'), 'audio/flac'],
    [Buffer.from('\0\0\0\x18ftypisomvideo', 'binary'), 'video/mp4'],
  ];

  for (const [bytes, expectedMime] of fixtures) {
    const document = incomingMediaMessage({
      messageKey: 'documentMessage', mimeType: 'application/octet-stream', bytes, fileName: 'upload.bin',
    });
    const result = await downloadIncomingMedia(document, document, { maxBytes: 1_000, logger });
    assert.equal(result.kind, 'document');
    assert.equal(result.mimeType, expectedMime);
  }
});

test('document transport accepts correctly labeled image files without changing the document kind', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const document = incomingMediaMessage({
    messageKey: 'documentMessage', mimeType: 'image/png', bytes: png, fileName: 'diagram.png',
  });

  const result = await downloadIncomingMedia(document, document, { maxBytes: 1_000, logger });

  assert.equal(result.kind, 'document');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.fileName, 'diagram.png');
});

test('Ogg media canonicalizes generic declarations for audio, video, and document transports', async () => {
  const ogg = Buffer.from('OggSmedia');
  const fixtures = [
    ['audioMessage', 'application/ogg', undefined, 'audio/ogg'],
    ['audioMessage', undefined, undefined, 'audio/ogg'],
    ['audioMessage', 'application/octet-stream', undefined, 'audio/ogg'],
    ['videoMessage', 'application/ogg', undefined, 'video/ogg'],
    ['documentMessage', 'application/ogg', 'recording.ogg', 'audio/ogg'],
    ['documentMessage', 'application/ogg', 'recording.ogv', 'video/ogg'],
  ];

  for (const [messageKey, mimeType, fileName, expectedMime] of fixtures) {
    const msg = incomingMediaMessage({ messageKey, mimeType, bytes: ogg, fileName });
    const result = await downloadIncomingMedia(msg, msg, { maxBytes: 1_000, logger });
    assert.equal(result.mimeType, expectedMime);
  }
});

test('generic audio MP4 and WebM containers use audio MIME types', async () => {
  const fixtures = [
    [Buffer.from('\0\0\0\x18ftypisommedia', 'binary'), 'audio/mp4'],
    [Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]), 'audio/webm'],
  ];

  for (const declaredMime of [undefined, 'application/octet-stream']) {
    for (const [bytes, expectedMime] of fixtures) {
      const audio = incomingMediaMessage({ messageKey: 'audioMessage', mimeType: declaredMime, bytes });
      const result = await downloadIncomingMedia(audio, audio, { maxBytes: 1_000, logger });
      assert.equal(result.mimeType, expectedMime);
    }
  }
});

test('document downloads reject definitive signature conflicts within broad MIME families', async () => {
  const conflicts = [
    ['text/plain', Buffer.from('%PDF-1.7\nfile'), 'notes.txt'],
    ['application/json', Buffer.from('PK\x03\x04archive', 'binary'), 'data.json'],
    ['image/png', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'picture.png'],
  ];

  for (const [mimeType, bytes, fileName] of conflicts) {
    const document = incomingMediaMessage({
      messageKey: 'documentMessage', mimeType, bytes, fileName,
    });
    await assert.rejects(
      downloadIncomingMedia(document, document, { maxBytes: 1_000, logger }),
      (error) => error instanceof MediaUserFacingError && error.message.includes('type does not match'),
    );
  }
});

test('all supported Office MIME declarations remain valid over ZIP containers', async () => {
  const zip = Buffer.from('PK\x03\x04office', 'binary');
  const officeMimes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
  ];

  for (const mimeType of officeMimes) {
    const document = incomingMediaMessage({
      messageKey: 'documentMessage', mimeType, bytes: zip, fileName: 'office-file',
    });
    const result = await downloadIncomingMedia(document, document, { maxBytes: 1_000, logger });
    assert.equal(result.mimeType, mimeType);
  }
});
