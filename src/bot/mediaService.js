import { isIP } from 'node:net';

import { Agent, Dispatcher } from 'undici';

const SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const noop = () => {};
const UNSAFE_URL_TEXT = /[\\\u0000-\u001f\u007f]/;

export class MediaUserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MediaUserFacingError';
    this.code = 'MEDIA_USER_FACING';
  }
}

function unwrap(content) {
  let current = content;
  const wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const wrapper = wrappers.find((key) => current[key]?.message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current;
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'bigint') return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : Number.POSITIVE_INFINITY;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value.toNumber === 'function') {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && Number.isInteger(value.low) && Number.isInteger(value.high)) {
    const low = value.low >>> 0;
    const high = value.high >>> 0;
    const parsed = high * 0x1_0000_0000 + low;
    return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
  }
  return undefined;
}

function detectMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

function normalizeMime(value) {
  if (typeof value !== 'string') return undefined;
  const mime = value.split(';')[0].trim().toLowerCase();
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

async function baileysDownload(message, type, options, context) {
  const { downloadMediaMessage } = await import('@whiskeysockets/baileys');
  return downloadMediaMessage(message, type, options, context);
}

function silentLogger(logger) {
  try {
    if (typeof logger?.child === 'function') return logger.child({ component: 'baileys_media' }, { level: 'silent' });
  } catch { /* use a silent fallback */ }
  return { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child() { return this; } };
}

function untrustedMediaError() {
  return new MediaUserFacingError('This image is not hosted by a trusted WhatsApp media service.');
}

function validateTrustedURL(value) {
  if (typeof value !== 'string' || value === '' || UNSAFE_URL_TEXT.test(value)) throw untrustedMediaError();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw untrustedMediaError();
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:'
    || url.username || url.password || url.port
    || url.hash || isIP(hostname) !== 0
    || !hostname.endsWith('.whatsapp.net')) {
    throw untrustedMediaError();
  }
  return url;
}

function validateDirectPath(value) {
  if (typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || UNSAFE_URL_TEXT.test(value)) {
    throw untrustedMediaError();
  }
}

function validateMediaReference(msg) {
  const media = unwrap(msg?.message)?.imageMessage;
  if (!media) throw new MediaUserFacingError('This image could not be read.');
  if (media.url !== undefined) validateTrustedURL(media.url);
  if (media.directPath !== undefined) validateDirectPath(media.directPath);
  if (media.url === undefined && media.directPath === undefined) throw untrustedMediaError();
  return media;
}

function validateDispatch(options) {
  const origin = validateTrustedURL(String(options?.origin ?? ''));
  const requestPath = options?.path;
  if (typeof requestPath !== 'string'
    || !requestPath.startsWith('/')
    || requestPath.startsWith('//')
    || UNSAFE_URL_TEXT.test(requestPath)) {
    throw untrustedMediaError();
  }
  const target = new URL(requestPath, origin);
  validateTrustedURL(target.href);
  if (target.origin !== origin.origin) throw untrustedMediaError();
}

class ValidatingMediaDispatcher extends Dispatcher {
  #agent = new Agent({ maxRedirections: 0 });

  dispatch(options, handler) {
    validateDispatch(options);
    return this.#agent.dispatch(options, handler);
  }

  close(...args) {
    return this.#agent.close(...args);
  }

  destroy(...args) {
    return this.#agent.destroy(...args);
  }
}

export async function downloadImageMessage(sock, msg, { maxBytes, timeoutMs, logger } = {}) {
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : 5 * 1024 * 1024;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000;
  const content = unwrap(msg?.message);
  const image = content?.imageMessage;
  if (!image) throw new MediaUserFacingError('This image could not be read.');
  validateMediaReference(msg);
  const declaredSize = numeric(image.fileLength);
  if (declaredSize !== undefined && declaredSize > limit) {
    throw new MediaUserFacingError('This image is too large to process.');
  }

  const download = typeof sock?.downloadMediaMessage === 'function'
    ? sock.downloadMediaMessage.bind(sock)
    : baileysDownload;
  let stream;
  let iterator;
  let timedOut = false;
  const controller = new AbortController();
  const dispatcher = new ValidatingMediaDispatcher();
  const timeoutError = new MediaUserFacingError('The image download timed out. Please try again.');
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      stream?.destroy?.();
      void dispatcher.destroy(timeoutError).catch(() => {});
      reject(timeoutError);
    }, timeout);
  });
  const beforeDeadline = (operation) => Promise.race([operation, timeoutPromise]);
  try {
    const downloadPromise = Promise.resolve(download(msg, 'stream', {
      options: { signal: controller.signal, dispatcher },
    }, {
      logger: silentLogger(logger),
      reuploadRequest: async (staleMessage) => {
        if (typeof sock?.updateMediaMessage !== 'function') throw new Error('Media reupload is unavailable');
        const updatedMessage = await sock.updateMediaMessage(staleMessage);
        validateMediaReference(updatedMessage);
        return updatedMessage;
      },
    })).then((candidate) => {
      if (timedOut) candidate?.destroy?.();
      return candidate;
    });
    stream = await beforeDeadline(downloadPromise);
    if (!stream?.[Symbol.asyncIterator]) throw new Error('Media download did not return a stream');
    iterator = stream[Symbol.asyncIterator]();
    const chunks = [];
    let size = 0;
    while (true) {
      const item = await beforeDeadline(iterator.next());
      if (item.done) break;
      const chunk = Buffer.isBuffer(item.value) ? item.value : Buffer.from(item.value);
      size += chunk.length;
      if (size > limit) {
        stream.destroy?.();
        throw new MediaUserFacingError('This image is too large to process.');
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks, size);
    const detectedMime = detectMime(buffer);
    if (!detectedMime) throw new MediaUserFacingError('Please send a supported image (JPEG, PNG, WebP, or GIF).');
    const declaredMime = normalizeMime(image.mimetype);
    if (declaredMime && (!SUPPORTED_MIME.has(declaredMime) || declaredMime !== detectedMime)) {
      throw new MediaUserFacingError('The image type does not match its content.');
    }
    return { buffer, mimeType: detectedMime };
  } catch (error) {
    if (error?.code === 'MEDIA_USER_FACING') throw error;
    if (timedOut) throw timeoutError;
    throw new MediaUserFacingError('This image could not be downloaded.');
  } finally {
    clearTimeout(timer);
    if (timedOut) {
      try { Promise.resolve(iterator?.return?.()).catch(() => {}); } catch { /* best effort */ }
      stream?.destroy?.();
    }
    await dispatcher.destroy(timedOut ? timeoutError : null).catch(() => {});
  }
}
