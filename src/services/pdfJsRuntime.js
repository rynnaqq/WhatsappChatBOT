import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SUPPORTED_VERSION = '6.2.108';
const SUPPORTED_SOURCE_SHA256 = '842284e0d1d439e60701e3355c2128cd3016ebebf14220e27f512467682aad66';
const SOURCE_MARKER = 'const FULL_CHUNK_HEIGHT = 16;';
const DERIVED_MARKER = 'const FULL_CHUNK_HEIGHT = 256;';
const MODIFICATION_NOTICE = `/*
 * NOTICE: This file was modified by whatsapp-ai-chatbot from pdfjs-dist ${SUPPORTED_VERSION}.
 * The application changes CanvasGraphics FULL_CHUNK_HEIGHT from 16 to 256 to avoid
 * pathological RGB-to-RGBA conversion time for high-resolution PDF page images.
 */`;

let runtimePromise;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runtimeError(check) {
  const error = new Error('The PDF rendering runtime is unavailable.');
  error.name = 'PdfJsRuntimeError';
  error.code = 'PDFJS_RUNTIME_INTEGRITY';
  error.check = check;
  return error;
}

async function readInstalledRuntime(sourceUrl) {
  let source;
  let packageData;
  try {
    [source, packageData] = await Promise.all([
      readFile(sourceUrl),
      readFile(new URL('../../package.json', sourceUrl), 'utf8'),
    ]);
  } catch {
    throw runtimeError('source-read');
  }

  let packageJson;
  try {
    packageJson = JSON.parse(packageData);
  } catch {
    throw runtimeError('package-version');
  }
  if (packageJson?.version !== SUPPORTED_VERSION) throw runtimeError('package-version');

  const sourceText = source.toString('utf8');
  if (sourceText.split(SOURCE_MARKER).length - 1 !== 1) throw runtimeError('source-marker');
  if (sha256(source) !== SUPPORTED_SOURCE_SHA256) throw runtimeError('source-hash');
  return sourceText;
}

async function verifyDerivedRuntime(path, expectedHash) {
  let existing;
  try {
    existing = await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw runtimeError('derived-read');
  }
  if (sha256(existing) !== expectedHash) throw runtimeError('derived-hash');
  return true;
}

async function createDerivedRuntime(sourceUrl, sourceText) {
  const licenseEnd = sourceText.indexOf('*/');
  if (licenseEnd < 0) throw runtimeError('source-license');
  const sourceWithNotice = `${sourceText.slice(0, licenseEnd + 2)}\n\n${MODIFICATION_NOTICE}${sourceText.slice(licenseEnd + 2)}`;
  const derivedSource = sourceWithNotice.replace(SOURCE_MARKER, DERIVED_MARKER);
  const derivedHash = sha256(derivedSource);
  const derivedUrl = new URL(`./pdf.chatbot-${derivedHash}.mjs`, sourceUrl);
  const derivedPath = fileURLToPath(derivedUrl);
  if (await verifyDerivedRuntime(derivedPath, derivedHash)) return derivedUrl;

  const temporaryPath = `${derivedPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, derivedSource, { flag: 'wx' });
    try {
      await rename(temporaryPath, derivedPath);
    } catch {
      if (!await verifyDerivedRuntime(derivedPath, derivedHash)) throw runtimeError('derived-write');
    }
  } catch (error) {
    if (error?.name === 'PdfJsRuntimeError') throw error;
    throw runtimeError('derived-write');
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
  if (!await verifyDerivedRuntime(derivedPath, derivedHash)) throw runtimeError('derived-hash');
  return derivedUrl;
}

async function loadVerifiedRuntime() {
  try {
    const sourceUrl = new URL(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
    const sourceText = await readInstalledRuntime(sourceUrl);
    const derivedUrl = await createDerivedRuntime(sourceUrl, sourceText);
    const runtime = await import(derivedUrl.href);
    if (typeof runtime?.getDocument !== 'function' || !runtime?.OPS || !runtime?.VerbosityLevel) {
      throw runtimeError('derived-module');
    }
    return runtime;
  } catch (error) {
    if (error?.name === 'PdfJsRuntimeError') throw error;
    throw runtimeError('runtime-load');
  }
}

export function loadPdfJsRuntime() {
  runtimePromise ??= loadVerifiedRuntime();
  return runtimePromise;
}
