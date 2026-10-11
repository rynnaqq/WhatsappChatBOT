import { parentPort, workerData } from 'node:worker_threads';

const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const PDF_READER_VERSION = 'pdf-256-budget-v1';

function postProgress(phase, { pageNumber = 0, pageCount = 0, completedPages = 0 } = {}) {
  try {
    parentPort.postMessage({
      type: 'progress',
      phase,
      pageNumber,
      pageCount,
      completedPages,
      readerVersion: PDF_READER_VERSION,
    });
  } catch {
    // Progress is diagnostic only.
  }
}

async function readDocument() {
  postProgress('boot');
  const buffer = Buffer.from(workerData.buffer);
  if (workerData.fileType === 'doc') {
    postProgress('parser_import');
    const { parseLegacyDoc } = await import('./legacyDocParser.js');
    postProgress('office_parse');
    return parseLegacyDoc(buffer, { maxChars: workerData.maxChars });
  }
  postProgress('parser_import');
  const { OfficeParser } = await import('officeparser');
  const parserOptions = {
    fileType: workerData.fileType,
    abortSignal: null,
    extractAttachments: false,
    includeRawContent: false,
    ocr: false,
    ignoreComments: true,
    decompressionLimits: {
      maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
      maxZipEntries: 512,
      maxTableCells: 100_000,
      maxXmlElements: 500_000,
      maxRepeatedContent: 2 * 1024 * 1024,
      maxRawContentLength: 0,
    },
  };
  if (workerData.fileType === 'pdf') parserOptions.pdfParserConfig = { separateProcess: false };
  postProgress('office_parse');
  const ast = await OfficeParser.parseOffice(buffer, parserOptions);
  if (workerData.fileType === 'pdf') {
    postProgress('pdf_runtime');
    const { readPdfDocument } = await import('./pdfDocumentReader.js');
    return readPdfDocument(buffer, ast, {
      maxChars: workerData.maxChars,
      includeVisuals: workerData.includeVisuals,
      onProgress: update => postProgress(update.phase, update),
    });
  }
  const generated = await ast.to(workerData.fileType === 'docx' ? 'md' : 'text',
    workerData.fileType === 'docx' ? { includeImages: 'none', fallbackToHtml: true } : { includeImages: 'none' });
  const text = typeof generated?.value === 'string' ? generated.value : '';
  const truncated = text.length > workerData.maxChars;
  return { text: truncated ? text.slice(0, workerData.maxChars) : text, truncated };
}

try {
  parentPort.postMessage({ ok: true, ...await readDocument() });
} catch (error) {
  parentPort.postMessage({ ok: false, errorCode: typeof error?.code === 'string' ? error.code : typeof error?.officeIssue?.code === 'string' ? error.officeIssue.code : null });
}
