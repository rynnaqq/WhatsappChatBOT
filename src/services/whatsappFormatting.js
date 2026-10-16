const WORD = /[\p{L}\p{N}_]/u;
const SPACE = /\s/u;

function before(text, index) {
  const last = text.charCodeAt(index - 1);
  const first = text.charCodeAt(index - 2);
  return last >= 0xDC00 && last <= 0xDFFF && first >= 0xD800 && first <= 0xDBFF
    ? text.slice(index - 2, index) : (text[index - 1] ?? '');
}

function escapedAt(text, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function formatLine(line, state) {
  let opening = -1;
  const cuts = [];
  for (let index = 0; index < line.length; index += 1) {
    const marker = line[index];
    if (marker !== '`' && marker !== '*') continue;
    let end = index + 1;
    while (line[end] === marker) end += 1;
    const count = end - index;
    if (escapedAt(line, index)) { index = end - 1; continue; }
    if (marker === '`') {
      if (state.inlineCode === 0) state.inlineCode = count;
      else if (state.inlineCode === count) state.inlineCode = 0;
      index = end - 1;
      continue;
    }
    if (state.inlineCode !== 0 || count !== 2) { index = end - 1; continue; }

    const previous = before(line, index);
    const next = end < line.length ? String.fromCodePoint(line.codePointAt(end)) : '';
    // Attached powers and path wildcards are literal syntax, even inside bold prose.
    const power = previous && next && (WORD.test(previous) || ')]}|'.includes(previous))
      && (WORD.test(next) || '([{+-|'.includes(next) || (next === '.' && /[0-9]/.test(line[end + 1] ?? '')));
    if (power || previous === '/' || previous === '\\' || next === '/' || next === '\\') {
      index = end - 1;
      continue;
    }
    const canClose = previous !== '' && !SPACE.test(previous) && !WORD.test(next);
    const canOpen = next !== '' && !SPACE.test(next) && !WORD.test(previous);
    if (opening >= 0 && canClose && index > opening + 2) {
      // Remove one star from each delimiter, leaving the enclosed text untouched.
      cuts.push(opening + 1, index + 1);
      opening = -1;
    } else if (canOpen) {
      opening = index;
    }
    index = end - 1;
  }
  if (cuts.length === 0) return line;
  const pieces = [];
  let start = 0;
  for (const cut of cuts) { pieces.push(line.slice(start, cut)); start = cut + 1; }
  pieces.push(line.slice(start));
  return pieces.join('');
}

// Convert balanced Markdown bold in prose; preserve code, literal syntax and ambiguous stars.
export function normalizeWhatsAppBold(value) {
  if (typeof value !== 'string') return '';
  if (!value.includes('**')) return value;
  const parts = value.split(/(\r\n|\r|\n)/);
  const state = { inlineCode: 0 };
  let fence = null;
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const codeLine = line.replace(/^(?: {0,3}>[ \t]?)+/, '');
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(codeLine);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && /^[ \t]*$/.test(marker[2])) fence = null;
      continue;
    }
    if (marker && state.inlineCode === 0 && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = { marker: marker[1][0], length: marker[1].length };
      continue;
    }
    if (state.inlineCode === 0 && /^(?: {4}|\t)/.test(codeLine)) continue;
    parts[index] = formatLine(line, state);
  }
  return parts.join('');
}
