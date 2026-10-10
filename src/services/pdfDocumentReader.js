import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';
import { OfficeGenerator } from 'officeparser';
import { getDocument, OPS, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_VISUAL_PAGES = 20;
const MAX_VISUAL_BYTES = 8 * 1024 * 1024;
const MAX_RENDER_SCALE = 2.5;
const MAX_FINAL_PAGE_LONG_EDGE = 2400;
const MAX_FINAL_PAGE_PIXELS = 4_000_000;
const MAX_INTERNAL_CANVAS_LONG_EDGE = 8192;
const MAX_INTERNAL_CANVAS_PIXELS = 16_000_000;
const LOW_TEXT_CHARACTERS = 24;
const WIDE_GAP_POINTS = 48;

const PDFJS_MODULE_URL = import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const PDFJS_PACKAGE_URL = new URL('../../', PDFJS_MODULE_URL);

const IMAGE_PAINT_OPERATORS = new Set([
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintSolidColorImageMask,
]);
const INCOMPLETE_AST_WARNING_CODES = new Set([
  'PAGE_LOAD_FAILED',
  'PDF_CONTENT_LIMIT_EXCEEDED',
]);

function assertCanvasSize(width, height) {
  if (!Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > MAX_INTERNAL_CANVAS_LONG_EDGE
    || height > MAX_INTERNAL_CANVAS_LONG_EDGE
    || width * height > MAX_INTERNAL_CANVAS_PIXELS) {
    throw limitError('PDF_CONTENT_LIMIT', 'The PDF contains an unsupported image size.');
  }
}

class NativeCanvasFactory {
  create(width, height) {
    assertCanvasSize(width, height);
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(canvasAndContext, width, height) {
    if (!canvasAndContext?.canvas) throw limitError('PDF_CONTENT_LIMIT', 'The PDF canvas is unavailable.');
    assertCanvasSize(width, height);
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    if (!canvasAndContext?.canvas) return;
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

function limitError(code, message) {
  const error = new Error(message);
  error.name = 'PdfDocumentLimitError';
  error.code = code;
  return error;
}

function pdfJsAssetPath(directory) {
  const path = fileURLToPath(new URL(`${directory}/`, PDFJS_PACKAGE_URL)).replaceAll('\\', '/');
  return path.endsWith('/') ? path : `${path}/`;
}

function hasIncompleteAstWarning(ast) {
  return Array.isArray(ast?.warnings)
    && ast.warnings.some(warning => INCOMPLETE_AST_WARNING_CODES.has(warning?.code));
}

function hasVisualAstNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'table' || node.type === 'image') return true;
  return Array.isArray(node.children) && node.children.some(hasVisualAstNode);
}

function textItemsFrom(textContent) {
  return textContent.items.filter(item => typeof item?.str === 'string' && item.str.trim());
}

function hasWideHorizontalGap(items) {
  const lines = [];
  for (const item of items) {
    const x = Number(item.transform?.[4]);
    const y = Number(item.transform?.[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    let line = lines.find(candidate => Math.abs(candidate.baseline - y) <= 2);
    if (!line) {
      line = { baseline: y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }

  return lines.some(line => {
    const ordered = line.items.toSorted((left, right) => left.transform[4] - right.transform[4]);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const previousEnd = previous.transform[4] + Math.max(0, Number(previous.width) || 0);
      const height = Math.max(
        Math.abs(Number(previous.height) || Number(previous.transform?.[3]) || 0),
        Math.abs(Number(current.height) || Number(current.transform?.[3]) || 0),
      );
      if (current.transform[4] - previousEnd > Math.max(WIDE_GAP_POINTS, height * 3)) return true;
    }
    return false;
  });
}

async function pageNeedsVisual(page) {
  const [textContent, operatorList] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ]);
  const items = textItemsFrom(textContent);
  const text = items.map(item => item.str).join(' ').trim();
  return text.length < LOW_TEXT_CHARACTERS
    || operatorList.fnArray.some(operator => IMAGE_PAINT_OPERATORS.has(operator))
    || hasWideHorizontalGap(items);
}

async function inspectPdf(pdf, ast) {
  let needsVisual = Array.isArray(ast?.content) && ast.content.some(hasVisualAstNode);
  if (needsVisual) return true;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    let page;
    try {
      page = await pdf.getPage(pageNumber);
      if (await pageNeedsVisual(page)) needsVisual = true;
    } finally {
      page?.cleanup();
    }
    if (needsVisual) break;
  }
  return needsVisual;
}

async function generatePageText(ast, page, pageNumber, pageCount) {
  let body = '';
  if (page) {
    const generated = await OfficeGenerator.generate(
      { ...ast, content: [page] },
      'md',
      { includeImages: 'none', fallbackToHtml: true },
    );
    if (typeof generated?.value === 'string') body = generated.value.trim();
  }
  return `Page ${pageNumber} of ${pageCount}${body ? `\n\n${body}` : ''}`;
}

async function generateDocumentText(ast, pageCount, maxChars) {
  const sections = [];
  for (let index = 0; index < pageCount; index += 1) {
    sections.push(await generatePageText(ast, ast?.content?.[index], index + 1, pageCount));
  }
  const text = sections.join('\n\n');
  return text.length > maxChars
    ? { text: text.slice(0, maxChars), truncated: true }
    : { text, truncated: false };
}

function renderViewport(page) {
  const unscaled = page.getViewport({ scale: 1 });
  const longEdgeScale = MAX_FINAL_PAGE_LONG_EDGE / Math.max(unscaled.width, unscaled.height);
  const pixelScale = Math.sqrt(MAX_FINAL_PAGE_PIXELS / (unscaled.width * unscaled.height));
  const scale = Math.min(MAX_RENDER_SCALE, longEdgeScale, pixelScale);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw limitError('PDF_CONTENT_LIMIT', 'The PDF contains an unsupported page size.');
  }
  return page.getViewport({ scale });
}

async function renderPdf(pdf) {
  if (pdf.numPages > MAX_VISUAL_PAGES) {
    throw limitError(
      'PDF_VISUAL_PAGE_LIMIT',
      `PDF visual reading supports at most ${MAX_VISUAL_PAGES} pages.`,
    );
  }

  const visualPages = [];
  const canvasFactory = new NativeCanvasFactory();
  let totalBytes = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    let page;
    let canvasAndContext;
    try {
      page = await pdf.getPage(pageNumber);
      const viewport = renderViewport(page);
      canvasAndContext = canvasFactory.create(Math.floor(viewport.width), Math.floor(viewport.height));
      await page.render({
        canvas: canvasAndContext.canvas,
        canvasContext: canvasAndContext.context,
        viewport,
        background: '#ffffff',
      }).promise;
      const bytes = canvasAndContext.canvas.toBuffer('image/jpeg', 92);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_VISUAL_BYTES) {
        throw limitError(
          'PDF_VISUAL_BYTES_LIMIT',
          'The rendered PDF is too large for visual reading.',
        );
      }
      visualPages.push({ pageNumber, bytes });
    } finally {
      if (canvasAndContext) canvasFactory.destroy(canvasAndContext);
      page?.cleanup();
    }
  }
  return visualPages;
}

export async function readPdfDocument(buffer, ast, { maxChars = 60_000, includeVisuals = false } = {}) {
  if (!Number.isSafeInteger(maxChars) || maxChars < 0) {
    throw limitError('PDF_CONTENT_LIMIT', 'The PDF text limit is invalid.');
  }
  if (hasIncompleteAstWarning(ast)) {
    throw limitError('PDF_CONTENT_LIMIT', 'The PDF exceeds the safe content reading limits.');
  }

  const data = new Uint8Array(buffer);
  const loadingTask = getDocument({
    data,
    CanvasFactory: NativeCanvasFactory,
    verbosity: VerbosityLevel.ERRORS,
    isEvalSupported: false,
    cMapUrl: pdfJsAssetPath('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: pdfJsAssetPath('standard_fonts'),
    wasmUrl: pdfJsAssetPath('wasm'),
  });

  let pdf;
  try {
    pdf = await loadingTask.promise;
    const [textResult, needsVisual] = await Promise.all([
      generateDocumentText(ast, pdf.numPages, maxChars),
      inspectPdf(pdf, ast),
    ]);
    const visualPages = needsVisual && includeVisuals ? await renderPdf(pdf) : [];
    return {
      ...textResult,
      visualPages,
      pageCount: pdf.numPages,
      requiresNative: needsVisual && !includeVisuals,
    };
  } finally {
    await loadingTask.destroy();
  }
}
