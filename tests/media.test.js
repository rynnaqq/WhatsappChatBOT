import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadImageMessage, MediaUserFacingError } from '../src/bot/mediaService.js';

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
