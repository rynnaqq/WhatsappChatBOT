import { parentPort, workerData } from 'node:worker_threads';

const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

try {
  const { OfficeParser } = await import('officeparser');
  const ast = await OfficeParser.parseOffice(Buffer.from(workerData.buffer), {
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
  });
  const generated = await ast.to('text');
  const text = typeof generated?.value === 'string' ? generated.value : '';
  const truncated = text.length > workerData.maxChars;
  parentPort.postMessage({ ok: true, text: truncated ? text.slice(0, workerData.maxChars) : text, truncated });
} catch (error) {
  parentPort.postMessage({ ok: false, errorCode: typeof error?.officeIssue?.code === 'string' ? error.officeIssue.code : null });
}
