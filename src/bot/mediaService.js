import { isIP } from 'node:net';

import { Agent, Dispatcher } from 'undici';

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MEDIA_KEYS = [
  ['imageMessage', 'image'],
  ['stickerMessage', 'sticker'],
  ['audioMessage', 'audio'],
  ['videoMessage', 'video'],
  ['ptvMessage', 'video'],
  ['documentMessage', 'document'],
];
const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
];
const ZIP_CONTAINER_MIME = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]);
const EXECUTABLE_MIME = new Set([
  'application/x-executable',
  'application/x-elf',
  'application/x-msdownload',
  'application/vnd.microsoft.portable-executable',
]);
const noop = () => {};
const UNSAFE_URL_TEXT = /[\\\u0000-\u001f\u007f]/;
const CONTROL_TEXT = /[\u0000-\u001f\u007f]/g;

export class MediaUserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MediaUserFacingError';
    this.code = 'MEDIA_USER_FACING';
  }
}

function unwrap(content) {
  let current = content;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const wrapper = WRAPPERS.find((key) => current[key]?.message);
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current;
}

function selectMedia(msg, requiredKey) {
  const content = unwrap(msg?.message);
  if (!content || typeof content !== 'object') return null;
  const entry = MEDIA_KEYS.find(([key]) => (!requiredKey || key === requiredKey) && content[key]);
  if (!entry) return null;
  const [key, kind] = entry;
  return { key, kind, media: content[key] };
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

function normalizeMime(value) {
  if (typeof value !== 'string') return undefined;
  const mime = value.split(';')[0].trim().toLowerCase();
  if (!mime || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)) return undefined;
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

function mimeFamily(mime) {
  if (!mime) return undefined;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

function expectedFamily(kind) {
  return kind === 'sticker' ? 'image' : kind;
}

function contextualDetectedMime(selected, signature) {
  if (!signature) return undefined;
  if (signature.mime === 'application/ogg') {
    if (selected.kind === 'video') return 'video/ogg';
    if (selected.kind === 'document' && /\.ogv$/i.test(selected.media.fileName ?? '')) return 'video/ogg';
    return 'audio/ogg';
  }
  if (selected.kind === 'audio' && signature.families.has('audio')) {
    if (signature.mime === 'video/mp4') return 'audio/mp4';
    if (signature.mime === 'video/webm') return 'audio/webm';
  }
  return signature.mime;
}

function isGenericDeclaration(declaredMime, signature) {
  return !declaredMime
    || declaredMime === 'application/octet-stream'
    || declaredMime === 'application/ogg' && signature?.mime === 'application/ogg';
}

function documentDeclarationMatches(declaredMime, signature) {
  if (signature.mime === 'application/zip') return ZIP_CONTAINER_MIME.has(declaredMime);
  if (signature.mime === 'application/pdf') return declaredMime === 'application/pdf';
  if (signature.families.has('image')) return declaredMime === signature.mime;
  if (signature.mime === 'application/ogg') {
    return declaredMime === 'audio/ogg' || declaredMime === 'video/ogg';
  }
  if (signature.mime === 'video/mp4') return declaredMime === 'audio/mp4' || declaredMime === 'video/mp4';
  if (signature.mime === 'video/webm') return declaredMime === 'audio/webm' || declaredMime === 'video/webm';
  if (signature.mime === 'application/x-executable') return EXECUTABLE_MIME.has(declaredMime);
  if (signature.families.has('audio') || signature.families.has('video')) return declaredMime === signature.mime;
  return true;
}

function hasPrefix(buffer, value, offset = 0, encoding = 'ascii') {
  const expected = Buffer.from(value, encoding);
  return buffer.length >= offset + expected.length && buffer.subarray(offset, offset + expected.length).equals(expected);
}

function detectSignature(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', families: new Set(['image']) };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', families: new Set(['image']) };
  }
  if (hasPrefix(buffer, 'GIF87a') || hasPrefix(buffer, 'GIF89a')) {
    return { mime: 'image/gif', families: new Set(['image']) };
  }
  if (hasPrefix(buffer, 'RIFF') && hasPrefix(buffer, 'WEBP', 8)) {
    return { mime: 'image/webp', families: new Set(['image']) };
  }
  if (hasPrefix(buffer, '%PDF-')) return { mime: 'application/pdf', families: new Set(['document']) };
  if (hasPrefix(buffer, 'PK\x03\x04', 0, 'binary')
    || hasPrefix(buffer, 'PK\x05\x06', 0, 'binary')
    || hasPrefix(buffer, 'PK\x07\x08', 0, 'binary')) {
    return { mime: 'application/zip', families: new Set(['document']) };
  }
  if (hasPrefix(buffer, 'OggS')) return { mime: 'application/ogg', families: new Set(['audio', 'video']) };
  if (hasPrefix(buffer, 'fLaC')) return { mime: 'audio/flac', families: new Set(['audio']) };
  if (hasPrefix(buffer, 'ID3') || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return { mime: 'audio/mpeg', families: new Set(['audio']) };
  }
  if (hasPrefix(buffer, 'RIFF') && hasPrefix(buffer, 'WAVE', 8)) {
    return { mime: 'audio/wav', families: new Set(['audio']) };
  }
  if (buffer.length >= 12 && hasPrefix(buffer, 'ftyp', 4)) {
    const brand = buffer.subarray(8, 12).toString('ascii');
    const audioOnly = /^(M4A |M4B |F4A |F4B )$/.test(brand);
    return {
      mime: audioOnly ? 'audio/mp4' : 'video/mp4',
      families: audioOnly ? new Set(['audio']) : new Set(['audio', 'video']),
    };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { mime: 'video/webm', families: new Set(['audio', 'video']) };
  }
  if (hasPrefix(buffer, 'MZ') || (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])))) {
    return { mime: 'application/x-executable', families: new Set(['executable']) };
  }
  return undefined;
}

function extensionFor(kind, mime) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/flac': 'flac',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
  };
  return extensions[mime] ?? (kind === 'document' ? 'bin' : 'dat');
}

function sanitizeFileName(value, kind, mime) {
  const fallbackBase = kind === 'audio' ? 'audio'
    : kind === 'video' ? 'video'
      : kind === 'sticker' ? 'sticker'
        : kind === 'image' ? 'image' : 'document';
  let name = typeof value === 'string' ? value.split(/[\\/]/).at(-1) : '';
  name = name.normalize('NFKC').replace(CONTROL_TEXT, '').replace(/[:*?"<>|]/g, '_').trim();
  name = name.replace(/^[. ]+|[. ]+$/g, '');
  if (!name) name = `${fallbackBase}.${extensionFor(kind, mime)}`;
  if (name.length > 180) {
    const dot = name.lastIndexOf('.');
    const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    name = `${name.slice(0, 180 - extension.length)}${extension}`;
  }
  return name;
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

function mediaLabel(kind) {
  return kind === 'image' || kind === 'sticker' ? 'image' : 'file';
}

function unreadableError(kind) {
  return new MediaUserFacingError(`This ${mediaLabel(kind)} could not be read.`);
}

function untrustedMediaError(kind = 'image') {
  return new MediaUserFacingError(`This ${mediaLabel(kind)} is not hosted by a trusted WhatsApp media service.`);
}

function validateTrustedURL(value, kind) {
  if (typeof value !== 'string' || value === '' || UNSAFE_URL_TEXT.test(value)) throw untrustedMediaError(kind);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw untrustedMediaError(kind);
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:'
    || url.username || url.password || url.port
    || url.hash || isIP(hostname) !== 0
    || !hostname.endsWith('.whatsapp.net')) {
    throw untrustedMediaError(kind);
  }
  return url;
}

function validateDirectPath(value, kind) {
  if (typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || UNSAFE_URL_TEXT.test(value)) {
    throw untrustedMediaError(kind);
  }
}

function validateMediaReference(msg, requiredKey, requiredKind) {
  const selected = selectMedia(msg, requiredKey);
  if (!selected || (requiredKind && selected.kind !== requiredKind)) throw unreadableError(requiredKind ?? 'file');
  const { media, kind } = selected;
  if (media.url !== undefined) validateTrustedURL(media.url, kind);
  if (media.directPath !== undefined) validateDirectPath(media.directPath, kind);
  if (media.url === undefined && media.directPath === undefined) throw untrustedMediaError(kind);
  return selected;
}

function validateDispatch(options) {
  const origin = validateTrustedURL(String(options?.origin ?? ''), 'file');
  const requestPath = options?.path;
  if (typeof requestPath !== 'string'
    || !requestPath.startsWith('/')
    || requestPath.startsWith('//')
    || UNSAFE_URL_TEXT.test(requestPath)) {
    throw untrustedMediaError('file');
  }
  const target = new URL(requestPath, origin);
  validateTrustedURL(target.href, 'file');
  if (target.origin !== origin.origin) throw untrustedMediaError('file');
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

function validateContent(selected, buffer) {
  const declaredMime = normalizeMime(selected.media.mimetype);
  const family = expectedFamily(selected.kind);
  const declaredFamily = mimeFamily(declaredMime);
  const signature = detectSignature(buffer);
  const genericDeclaration = isGenericDeclaration(declaredMime, signature);
  const detectedMime = contextualDetectedMime(selected, signature);

  if (selected.kind === 'document') {
    if (!genericDeclaration && signature && !documentDeclarationMatches(declaredMime, signature)) {
      throw new MediaUserFacingError('The file type does not match its content.');
    }
  } else {
    if (!genericDeclaration && declaredFamily && declaredFamily !== family) {
      throw new MediaUserFacingError(`The ${mediaLabel(selected.kind)} type does not match its content.`);
    }
    if (signature && !signature.families.has(family)) {
      throw new MediaUserFacingError(`The ${mediaLabel(selected.kind)} type does not match its content.`);
    }
  }
  if (family === 'image') {
    if (!signature || !IMAGE_MIME.has(signature.mime)) {
      throw new MediaUserFacingError('Please send a supported image (JPEG, PNG, WebP, or GIF).');
    }
    if (!genericDeclaration && declaredMime && (!IMAGE_MIME.has(declaredMime) || declaredMime !== signature.mime)) {
      throw new MediaUserFacingError('The image type does not match its content.');
    }
  }
  if (genericDeclaration && detectedMime) {
    if (declaredMime === 'application/octet-stream' && detectedMime === 'application/x-executable') {
      return declaredMime;
    }
    return detectedMime;
  }
  return declaredMime ?? signature?.mime ?? 'application/octet-stream';
}

async function downloadSelectedMedia(sock, msg, selected, options = {}) {
  const limit = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes : selected.kind === 'image' || selected.kind === 'sticker' ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
  const timeout = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 60_000;
  validateMediaReference(msg, selected.key, selected.kind);
  const declaredSize = numeric(selected.media.fileLength);
  if (declaredSize !== undefined && declaredSize > limit) {
    throw new MediaUserFacingError(`This ${mediaLabel(selected.kind)} is too large to process.`);
  }

  const download = typeof options.downloadMediaMessage === 'function'
    ? options.downloadMediaMessage
    : typeof sock?.downloadMediaMessage === 'function'
      ? sock.downloadMediaMessage.bind(sock)
      : baileysDownload;
  let stream;
  let iterator;
  let timedOut = false;
  const controller = new AbortController();
  const dispatcher = typeof options.dispatcherFactory === 'function'
    ? options.dispatcherFactory() : new ValidatingMediaDispatcher();
  const timeoutError = new MediaUserFacingError(`The ${mediaLabel(selected.kind)} download timed out. Please try again.`);
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      stream?.destroy?.();
      void Promise.resolve(dispatcher.destroy(timeoutError)).catch(() => {});
      reject(timeoutError);
    }, timeout);
  });
  const beforeDeadline = (operation) => Promise.race([operation, timeoutPromise]);
  try {
    const downloadPromise = Promise.resolve(download(msg, 'stream', {
      options: { signal: controller.signal, dispatcher },
    }, {
      logger: silentLogger(options.logger),
      reuploadRequest: async (staleMessage) => {
        if (typeof sock?.updateMediaMessage !== 'function') throw new Error('Media reupload is unavailable');
        const updatedMessage = await sock.updateMediaMessage(staleMessage);
        validateMediaReference(updatedMessage, selected.key, selected.kind);
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
        throw new MediaUserFacingError(`This ${mediaLabel(selected.kind)} is too large to process.`);
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks, size);
    const mimeType = validateContent(selected, buffer);
    return {
      kind: selected.kind,
      buffer,
      mimeType,
      fileName: sanitizeFileName(selected.media.fileName, selected.kind, mimeType),
    };
  } catch (error) {
    if (error?.code === 'MEDIA_USER_FACING') throw error;
    if (timedOut) throw timeoutError;
    throw new MediaUserFacingError(`This ${mediaLabel(selected.kind)} could not be downloaded.`);
  } finally {
    clearTimeout(timer);
    if (timedOut) {
      try { Promise.resolve(iterator?.return?.()).catch(() => {}); } catch { /* best effort */ }
      stream?.destroy?.();
    }
    await Promise.resolve(dispatcher.destroy(timedOut ? timeoutError : null)).catch(() => {});
  }
}

export async function downloadIncomingMedia(msg, sock, options = {}) {
  const selected = selectMedia(msg);
  if (!selected) throw new MediaUserFacingError('This file could not be read.');
  return downloadSelectedMedia(sock, msg, selected, options);
}

export async function downloadImageMessage(sock, msg, options = {}) {
  const selected = selectMedia(msg, 'imageMessage');
  if (!selected) throw new MediaUserFacingError('This image could not be read.');
  const attachment = await downloadSelectedMedia(sock, msg, selected, options);
  return { buffer: attachment.buffer, mimeType: attachment.mimeType };
}
