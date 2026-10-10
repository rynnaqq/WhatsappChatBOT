import { Worker } from 'node:worker_threads';

const MEBIBYTE = 1024 * 1024;
const DEFAULT_IMAGE_MB = 5;
const DEFAULT_FILE_MB = 10;
const MAX_TEXT_CHARS = 60_000;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_ARCHIVE_BYTES = 32 * MEBIBYTE;
const OFFICE_TIMEOUT_MS = 15_000;
const MAX_ACTIVE_OFFICE_WORKERS = 2;
let activeOfficeWorkers = 0;

const OFFICE_FORMATS = new Map([
  ['docx', { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', required: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'] }],
  ['xlsx', { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', required: ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml'] }],
  ['pptx', { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', required: ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml'] }],
  ['odt', { mime: 'application/vnd.oasis.opendocument.text', required: ['mimetype', 'META-INF/manifest.xml', 'content.xml'] }],
  ['ods', { mime: 'application/vnd.oasis.opendocument.spreadsheet', required: ['mimetype', 'META-INF/manifest.xml', 'content.xml'] }],
  ['odp', { mime: 'application/vnd.oasis.opendocument.presentation', required: ['mimetype', 'META-INF/manifest.xml', 'content.xml'] }],
]);
const OFFICE_MIME_TYPES = new Map([...OFFICE_FORMATS].map(([type, format]) => [format.mime, type]));
const GENERIC_ARCHIVE_MIMES = new Set(['application/octet-stream', 'application/zip', 'application/x-zip-compressed']);
const TEXT_MIMES = new Set(['application/csv', 'application/ecmascript', 'application/javascript', 'application/json', 'application/ld+json', 'application/sql', 'application/x-httpd-php', 'application/x-javascript', 'application/xhtml+xml', 'application/xml']);
const TEXT_EXTENSIONS = new Set(['c', 'cc', 'conf', 'cpp', 'cs', 'css', 'csv', 'go', 'h', 'hpp', 'htm', 'html', 'ini', 'java', 'js', 'json', 'jsx', 'log', 'lua', 'md', 'mjs', 'php', 'properties', 'py', 'rb', 'rs', 'sh', 'sql', 'svg', 'toml', 'ts', 'tsx', 'txt', 'xml', 'yaml', 'yml']);
const EXECUTABLE_EXTENSIONS = new Set(['apk', 'app', 'bat', 'bin', 'cmd', 'com', 'dll', 'dmg', 'exe', 'jar', 'jscript', 'msi', 'ps1', 'scr', 'vbs']);
const LEGACY_OFFICE_EXTENSIONS = new Set(['doc', 'xls', 'ppt']);

export class AttachmentUserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AttachmentUserFacingError';
    this.code = 'ATTACHMENT_USER_FACING';
  }
}

export async function prepareAttachment(attachment, { ai = {}, signal } = {}) {
  try {
    validateAttachment(attachment);
    throwIfAborted(signal);
    const { kind, buffer } = attachment;
    const declaredMime = attachment.mimeType.trim().toLowerCase();
    const fileName = safeFileName(attachment.fileName, kind, declaredMime);
    const mimeType = canonicalMediaMime(declaredMime, kind, buffer, fileName);
    const ext = extensionOf(fileName);

    if (kind === 'image' || kind === 'sticker' || (kind === 'document' && mimeType.startsWith('image/'))) {
      return prepareImage({ kind, buffer, mimeType, fileName }, ai);
    }

    validateGeneralMedia(buffer, ai);
    if (LEGACY_OFFICE_EXTENSIONS.has(ext) || ['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'].includes(mimeType)) {
      throw new AttachmentUserFacingError('This legacy Office format is not supported. Save it as DOCX, XLSX, or PPTX and try again.');
    }
    if (kind === 'audio') return prepareNativeMedia('audio', kind, buffer, mimeType, fileName, ai);
    if (kind === 'video') return prepareNativeMedia('video', kind, buffer, mimeType, fileName, ai);
    if (kind === 'document' && mimeType.startsWith('audio/')) return prepareNativeMedia('audio', kind, buffer, mimeType, fileName, ai);
    if (kind === 'document' && mimeType.startsWith('video/')) return prepareNativeMedia('video', kind, buffer, mimeType, fileName, ai);
    const officeType = resolveOfficeType(ext, mimeType);
    if (officeType) {
      const office = OFFICE_FORMATS.get(officeType);
      const inventory = inspectZip(buffer);
      if (!office.required.every((name) => inventory.names.includes(name))) throw new AttachmentUserFacingError('The Office document is corrupt or does not match its file type.');
      if (officeType.startsWith('od') && inventory.odfMimeType !== office.mime) throw new AttachmentUserFacingError('The OpenDocument container does not match its declared file type.');
      const parsed = await parseOfficeInWorker(buffer, officeType, signal);
      throwIfAborted(signal);
      return textResult('document', fileName, office.mime, buffer.byteLength, parsed.value, parsed.truncated);
    }
    if (EXECUTABLE_EXTENSIONS.has(ext)) throw new AttachmentUserFacingError('Executable attachments cannot be processed.');
    if (mimeType === 'application/pdf' || ext === 'pdf') {
      if (mimeType !== 'application/pdf' || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new AttachmentUserFacingError('The PDF file is invalid or does not match its file type.');
      return nativeResult('document', buffer, mimeType, fileName, ai);
    }
    if (isPlainText(mimeType, ext)) {
      const decoded = decodeBoundedText(buffer);
      return textResult('document', fileName, mimeType, buffer.byteLength, decoded.text, decoded.truncated);
    }
    if (isZip(mimeType, ext)) {
      const listed = inspectZip(buffer).names.filter((name) => !name.endsWith('/'));
      const inventory = listed.length ? `Files in ${fileName}:\n${listed.map((name) => `- ${name}`).join('\n')}` : `Files in ${fileName}:\n(empty archive)`;
      const text = inventory.length > MAX_TEXT_CHARS
        ? `${inventory.slice(0, MAX_TEXT_CHARS)}\n[Archive inventory truncated to ${MAX_TEXT_CHARS} characters.]`
        : inventory;
      return { parts: [{ type: 'text', text }], memoryText: memoryPlaceholder('document', fileName, mimeType, buffer.byteLength) };
    }
    throw new AttachmentUserFacingError('This file format is not supported or cannot be read safely.');
  } catch (error) {
    if (error instanceof AttachmentUserFacingError || isAbortError(error)) throw error;
    throw new AttachmentUserFacingError('The attachment is corrupt or could not be processed safely.');
  }
}

function prepareImage({ kind, buffer, mimeType, fileName }, ai) {
  if (!ai.visionEnabled) throw new AttachmentUserFacingError('Image messages are disabled.');
  enforceSize(buffer, positiveMegabytes(ai.maxImageMB, DEFAULT_IMAGE_MB), 'Image');
  if (!mimeType.startsWith('image/')) throw new AttachmentUserFacingError('The image has an invalid file type.');
  return { parts: [{ type: 'image_url', image_url: { url: dataUrl(mimeType, buffer) } }], memoryText: memoryPlaceholder(kind, fileName, mimeType, buffer.byteLength) };
}

function validateGeneralMedia(buffer, ai) {
  if (ai.mediaEnabled === false) throw new AttachmentUserFacingError('File and media attachments are disabled.');
  enforceSize(buffer, positiveMegabytes(ai.maxFileMB, DEFAULT_FILE_MB), 'File');
}

function prepareNativeMedia(expectedPrefix, kind, buffer, mimeType, fileName, ai) {
  if (!mimeType.startsWith(`${expectedPrefix}/`)) throw new AttachmentUserFacingError(`The ${expectedPrefix} attachment has an invalid file type.`);
  return nativeResult(kind, buffer, mimeType, fileName, ai);
}

function nativeResult(kind, buffer, mimeType, fileName, ai) {
  const url = dataUrl(mimeType, buffer);
  let part;
  if (use9RouterGeminiTransport(ai)) {
    part = mimeType.startsWith('audio/')
      ? { type: 'audio_url', audio_url: { url } }
      : { type: 'image_url', image_url: { url } };
  } else {
    part = { type: 'file', file: { filename: fileName, file_data: url } };
  }
  return { parts: [part], memoryText: memoryPlaceholder(kind, fileName, mimeType, buffer.byteLength) };
}

function use9RouterGeminiTransport(ai) {
  if (ai.attachmentTransport === '9router-gemini') return true;
  if (ai.attachmentTransport === 'file') return false;
  return typeof ai.model === 'string' && /^ag\/gemini(?:[-.]|$)/i.test(ai.model);
}

function textResult(kind, fileName, mimeType, byteLength, text, truncated) {
  const content = text || '(No readable text was found.)';
  const notice = truncated ? `\n[Content truncated to ${MAX_TEXT_CHARS} characters.]` : '';
  return { parts: [{ type: 'text', text: `Contents of ${fileName}:\n${content}${notice}` }], memoryText: memoryPlaceholder(kind, fileName, mimeType, byteLength) };
}

function validateAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') throw new AttachmentUserFacingError('The attachment could not be processed.');
  if (!['image', 'sticker', 'audio', 'video', 'document'].includes(attachment.kind)) throw new AttachmentUserFacingError('This attachment type is not supported.');
  if (!Buffer.isBuffer(attachment.buffer) || attachment.buffer.byteLength === 0) throw new AttachmentUserFacingError('The attachment is empty or invalid.');
  if (typeof attachment.mimeType !== 'string' || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/i.test(attachment.mimeType.trim())) throw new AttachmentUserFacingError('The attachment has an invalid file type.');
}

function safeFileName(value, kind, mimeType) {
  const supplied = typeof value === 'string' ? value : '';
  const base = supplied.split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (base && base !== '.' && base !== '..') return base.slice(0, 128);
  const subtype = mimeType.split('/')[1].replace(/[^a-z0-9.+-]/gi, '').split('+')[0] || 'bin';
  return `${kind}.${subtype}`;
}

function positiveMegabytes(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function enforceSize(buffer, megabytes, label) {
  if (buffer.byteLength > megabytes * MEBIBYTE) throw new AttachmentUserFacingError(`${label} exceeds the ${megabytes} MB limit.`);
}

function dataUrl(mimeType, buffer) { return `data:${mimeType};base64,${buffer.toString('base64')}`; }
function canonicalMediaMime(mimeType, kind, buffer, fileName) {
  if (mimeType !== 'application/ogg') return mimeType;
  if (!buffer.subarray(0, 4).equals(Buffer.from('OggS'))) throw new AttachmentUserFacingError('The Ogg attachment does not match its file type.');
  return kind === 'video' || /\.ogv$/i.test(fileName) ? 'video/ogg' : 'audio/ogg';
}
function memoryPlaceholder(kind, fileName, mimeType, byteLength) { return `[${kind} sent: ${fileName} (${mimeType}, ${byteLength} bytes)]`; }
function extensionOf(fileName) { const index = fileName.lastIndexOf('.'); return index > 0 ? fileName.slice(index + 1).toLowerCase() : ''; }
function isPlainText(mimeType, extension) { return mimeType.startsWith('text/') || TEXT_MIMES.has(mimeType) || TEXT_EXTENSIONS.has(extension); }
function isZip(mimeType, extension) { return extension === 'zip' || mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed'; }

function resolveOfficeType(extension, mimeType) {
  const typeFromExtension = OFFICE_FORMATS.has(extension) ? extension : null;
  const typeFromMime = OFFICE_MIME_TYPES.get(mimeType) ?? null;
  if (typeFromExtension) {
    if (typeFromMime && typeFromMime !== typeFromExtension) throw new AttachmentUserFacingError('The Office document does not match its declared file type.');
    if (!typeFromMime && !GENERIC_ARCHIVE_MIMES.has(mimeType)) throw new AttachmentUserFacingError('The Office document does not match its declared file type.');
    return typeFromExtension;
  }
  if (!typeFromMime) return null;
  if (EXECUTABLE_EXTENSIONS.has(extension) && extension !== 'bin') throw new AttachmentUserFacingError('Executable attachments cannot be processed.');
  return typeFromMime;
}

function decodeBoundedText(buffer) {
  let text;
  try {
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2));
    else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(buffer.subarray(2));
    else {
      const start = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(start));
    }
  } catch {
    throw new AttachmentUserFacingError('The text file has an invalid or unsupported encoding.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new AttachmentUserFacingError('The text file contains binary control data and cannot be read safely.');
  return text.length <= MAX_TEXT_CHARS ? { text, truncated: false } : { text: text.slice(0, MAX_TEXT_CHARS), truncated: true };
}

function inspectZip(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0 || eocd + 22 > buffer.length) throw new AttachmentUserFacingError('The ZIP archive is corrupt.');
  const disk = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount || entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) throw new AttachmentUserFacingError('Multi-volume and ZIP64 archives are not supported.');
  if (entryCount > MAX_ARCHIVE_ENTRIES) throw new AttachmentUserFacingError('The ZIP archive contains too many files.');
  if (centralOffset + centralSize > eocd || centralOffset > buffer.length) throw new AttachmentUserFacingError('The ZIP archive is corrupt.');
  const names = [];
  let odfMimeType = null;
  let totalUncompressed = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new AttachmentUserFacingError('The ZIP archive is corrupt.');
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length || nameLength === 0) throw new AttachmentUserFacingError('The ZIP archive is corrupt.');
    if (flags & 1) throw new AttachmentUserFacingError('Encrypted ZIP archives are not supported.');
    totalUncompressed += uncompressed;
    if (totalUncompressed > MAX_ARCHIVE_BYTES) throw new AttachmentUserFacingError('The ZIP archive expands beyond the safe limit.');
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replaceAll('\\', '/');
    if (!isSafeArchiveName(name)) throw new AttachmentUserFacingError('The ZIP archive contains an unsafe file name.');
    if (localOffset + 30 > centralOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new AttachmentUserFacingError('The ZIP archive is corrupt.');
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if ((localFlags & 1) || localMethod !== compressionMethod || dataOffset + compressed > centralOffset) throw new AttachmentUserFacingError('The ZIP archive is corrupt or encrypted.');
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8').replaceAll('\\', '/');
    if (localName !== name) throw new AttachmentUserFacingError('The ZIP archive is corrupt.');
    if (name === 'mimetype') {
      if (compressionMethod !== 0 || uncompressed !== compressed || uncompressed > 256) throw new AttachmentUserFacingError('The OpenDocument mimetype entry is invalid.');
      odfMimeType = buffer.subarray(dataOffset, dataOffset + uncompressed).toString('ascii');
    }
    names.push(name);
    offset = end;
  }
  if (offset !== centralOffset + centralSize) throw new AttachmentUserFacingError('The ZIP archive is corrupt.');
  return { names, totalUncompressed, odfMimeType };
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) return offset;
  }
  return -1;
}

function isSafeArchiveName(name) {
  if (!name || name.includes('\0') || name.startsWith('/') || /^[a-z]:\//i.test(name)) return false;
  return !name.split('/').some((part) => part === '..');
}

async function parseOfficeInWorker(buffer, fileType, signal) {
  throwIfAborted(signal);
  if (activeOfficeWorkers >= MAX_ACTIVE_OFFICE_WORKERS) throw new AttachmentUserFacingError('The document reader is busy. Please retry shortly.');
  activeOfficeWorkers += 1;
  let worker;
  try {
    const bytes = Uint8Array.from(buffer);
    worker = new Worker(new URL('./officeParserWorker.js', import.meta.url), {
      workerData: { buffer: bytes.buffer, fileType, maxChars: MAX_TEXT_CHARS },
      transferList: [bytes.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
  } catch (error) {
    activeOfficeWorkers -= 1;
    throw error;
  }
  return new Promise((resolve, reject) => {
    let settling = false;
    let slotReleased = false;
    const releaseSlot = () => {
      if (slotReleased) return;
      slotReleased = true;
      activeOfficeWorkers -= 1;
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finishAfterTermination = (callback) => {
      if (settling) return;
      settling = true;
      cleanup();
      let termination;
      try {
        termination = worker.terminate();
      } catch {
        releaseSlot();
        callback();
        return;
      }
      Promise.resolve(termination).then(releaseSlot, releaseSlot).then(callback);
    };
    const finishAfterExit = (callback) => {
      if (settling) return;
      settling = true;
      cleanup();
      releaseSlot();
      callback();
    };
    const onAbort = () => finishAfterTermination(() => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')));
    const timer = setTimeout(() => finishAfterTermination(() => reject(new AttachmentUserFacingError('The Office document took too long to process.'))), OFFICE_TIMEOUT_MS);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (message) => finishAfterTermination(() => message?.ok
      ? resolve({ value: message.text, truncated: Boolean(message.truncated) })
      : reject(new AttachmentUserFacingError('The Office document is corrupt, encrypted, or could not be read safely.'))));
    worker.once('error', () => finishAfterTermination(() => reject(new AttachmentUserFacingError('The Office document could not be processed safely.'))));
    worker.once('exit', () => finishAfterExit(() => reject(new AttachmentUserFacingError('The Office document could not be processed safely.'))));
  });
}

function throwIfAborted(signal) { if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'); }
function isAbortError(error) { return error?.name === 'AbortError' || error?.code === 'ABORT_ERR'; }
