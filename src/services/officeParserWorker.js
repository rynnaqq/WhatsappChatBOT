import { parentPort, workerData } from 'node:worker_threads';

const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

async function readDocument() {
  const buffer = Buffer.from(workerData.buffer);
  if (workerData.fileType === 'doc') {
    const { parseLegacyDoc } = await import('./legacyDocParser.js');
    return parseLegacyDoc(buffer, { maxChars: workerData.maxChars });
  }
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
  const ast = await OfficeParser.parseOffice(buffer, parserOptions);
  if (workerData.fileType === 'pdf') {
    const { readPdfDocument } = await import('./pdfDocumentReader.js');
    return readPdfDocument(buffer, ast, { maxChars: workerData.maxChars, includeVisuals: workerData.includeVisuals });
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
