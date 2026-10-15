import {
  EXPRESSION_GROUPS,
  STICKER_CATALOG,
  STICKER_IDS,
  stickerFallback,
} from './expressionCatalog.js';

export { STICKER_IDS, stickerFallback };

const STICKER_ID_SET = new Set(STICKER_IDS);
const STICKER_CONTROL_LINE = /^\s*\[\[sticker:([^\]\r\n]{0,128})\]\]\s*$/i;
const MALFORMED_STICKER_CONTROL_LINE = /^\s*\[\[sticker:\s*[a-z0-9_./-]{0,128}\s*\]?\]?\s*$/i;

const EXPRESSION_GUIDE = EXPRESSION_GROUPS.map(({ label, emojis, kaomoji }) => (
  `${label}: emoji ${emojis.join(' ')}; kaomoji ${kaomoji.join(' ')}`
)).join(' | ');

const ACADEMIC_PRESENTATION_GUIDE = [
  'For study, document, homework, quiz, exam, and other academic tasks, use a calm, direct voice without greetings, emoji, kaomoji, flirting, stickers, or decorative clutter.',
  'For a multiple-choice answer, use simple WhatsApp formatting with single asterisks: *Jawaban: B. ...*, then a blank line, then *Penjelasan:* ... with a concise reason that supports the choice.',
  'Use labels in the user\'s language: Jawaban/Penjelasan for Indonesian, Answer/Explanation for English, keeping this same structure.',
  'When answering several numbered questions, preserve their original numbering and order and give each question its own answer-and-explanation block. For many questions, add a compact answer key first only when it is useful.',
  'Do not use Markdown tables, HTML, or decorative headings for these answers.',
  'Honor an explicit answer-only request or custom output format exactly. Preserve formulas, code, and quotations exactly when they matter to the answer.',
  'Do not invent missing or unreadable options, pretend certainty when the source is unclear, or hide ambiguity; briefly identify what is missing or ambiguous.',
].join(' ');

const FEMININE_STYLE = [
  'Use a warm, feminine, and natural conversational voice while staying focused on the user\'s request.',
  'Respect the user\'s language. When the user writes casual Indonesian, reply in relaxed Indonesian.',
  'For casual messages, choose one to three context-relevant expressions from the mood guide when they fit. Mix emoji and kaomoji naturally, vary choices across recent conversation history, and avoid repeating the same default expression.',
  'Expressions are optional: never pile them up, force one into every sentence, or let them replace a useful answer.',
  `Mood guide — ${EXPRESSION_GUIDE}.`,
  'For casual Indonesian, use gentle, supportive aku/kamu phrasing when it fits, without canned greetings or flirtation.',
  'Keep serious, technical, sensitive, error, and document answers clear and useful, with restrained expressions.',
  ACADEMIC_PRESENTATION_GUIDE,
  'Do not force flirting, stereotypes, romance, or a fake human identity or relationship.',
  'Never claim you used tools, read files, or performed actions unless that actually happened.',
].join(' ');

const STICKER_CHOICES = STICKER_CATALOG.map(({ id, label }) => `${label} [[sticker:${id}]]`).join('; ');

const STICKER_PROTOCOL = [
  'You may optionally choose one WhatsApp reaction sticker only when it naturally fits this casual exchange.',
  `Choose by mood from these available sticker controls: ${STICKER_CHOICES}.`,
  'If you choose one, put exactly one control on its own final line after the user-visible reply. Never place a control in prose or a code block.',
  'Do not claim in the user-visible reply that a sticker was sent; the application sends it only when a valid final control is present.',
  'A sticker is optional. Avoid it for serious, document, technical, error, or sensitive answers unless the user explicitly asks for a sticker.',
].join(' ');

export function buildReplySystemPrompt(settings, { text = '', attachment = null } = {}) {
  const bot = settings?.bot ?? {};
  const basePrompt = typeof bot.systemPrompt === 'string' ? bot.systemPrompt : '';
  const personaStyle = bot.personaStyle ?? 'feminine';
  const additions = [];
  if (personaStyle === 'feminine') additions.push(FEMININE_STYLE);
  if (stickerAllowed(settings, { text, attachment })) additions.push(STICKER_PROTOCOL);
  if (additions.length === 0) return basePrompt;
  return [basePrompt, ...additions].filter(Boolean).join('\n\n');
}

export function parseReply(value) {
  const text = typeof value === 'string' ? value.trimEnd() : '';
  if (!text.trim()) return { text: '', stickerId: null };

  const lines = text.split(/\r?\n/);
  let stickerId = null;
  let removedControl = false;
  while (lines.length > 0) {
    const lastLineIndex = lines.length - 1;
    if (removedControl && lines[lastLineIndex].trim() === '') {
      lines.pop();
      continue;
    }
    if (/^(?: {4,}|\t)/.test(lines[lastLineIndex])) break;
    const match = STICKER_CONTROL_LINE.exec(lines[lastLineIndex]);
    const malformedControl = !match && MALFORMED_STICKER_CONTROL_LINE.test(lines[lastLineIndex]);
    if ((!match && !malformedControl) || isInsideCodeFence(lines, lastLineIndex)) break;
    if (match) {
      const candidate = match[1].trim().toLowerCase();
      if (stickerId === null && STICKER_ID_SET.has(candidate)) stickerId = candidate;
    }
    lines.pop();
    removedControl = true;
  }
  if (!removedControl) return { text, stickerId: null };
  return {
    text: lines.join('\n').trimEnd(),
    stickerId,
  };
}

export function isStickerRequest(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim().toLowerCase();
  if (!text || isStickerRefusal(text) || isStickerInformationRequest(text)) return false;
  return [
    /\b(?:kirim(?:kan)?|kasih|beri(?:kan)?|balas|jawab|reply)\b[^.!?\n]{0,32}\b(?:pakai|pake|dengan)?\s*(?:stiker|sticker)s?\b/u,
    /\b(?:minta|mau|pengen|ingin)\b[^.!?\n]{0,24}\b(?:stiker|sticker)s?\b/u,
    /\b(?:stiker|sticker)s?\b[^.!?\n]{0,20}\b(?:dong|please|pls)\b/u,
    /\b(?:send|give|reply|respond)\b[^.!?\n]{0,32}\b(?:stiker|sticker)s?\b/u,
  ].some((pattern) => pattern.test(text));
}

export function stickerAllowed(settings, { text = '', attachment = null } = {}) {
  const mode = settings?.bot?.stickerReplies ?? 'contextual';
  if (mode === 'off') return false;
  if (isStickerRefusal(text) || isStickerInformationRequest(text)) return false;
  const explicitRequest = isStickerRequest(text);
  if (explicitRequest) return true;
  if (mode === 'on-request' || attachment) return false;
  if (mode !== 'contextual') return false;
  return isCasualStickerContext(text);
}

function isStickerRefusal(value) {
  if (typeof value !== 'string') return false;
  return /\b(?:jangan|tidak usah|ga(?:k| usah)?|nggak|don'?t|do not|no)\b[^.!?\n]{0,24}\b(?:stiker|sticker)s?\b/iu.test(value);
}

function isStickerInformationRequest(value) {
  if (typeof value !== 'string' || !/\b(?:stiker|sticker)s?\b/iu.test(value)) return false;
  const explanation = /\b(?:what|which|how|explain|jelaskan|cara|bagaimana|tutorial|panduan|langkah)\b/iu.test(value);
  const technical = /\b(?:api|endpoint|sdk|code|coding|kode|program|javascript|typescript|python|java|function|fungsi|method|metode)\b/iu.test(value);
  const howTo = /\b(?:cara|bagaimana|gimana|tutorial|panduan|langkah|explain|jelaskan|teach|ajari|ajarkan)\b|\bhow\s+(?:to|(?:do|can|should|would)\s+(?:i|we|someone))\b/iu.test(value);
  return howTo || (explanation && technical);
}

function isCasualStickerContext(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim().toLowerCase();
  if (!text || text.length > 400) return false;
  const serious = /\b(?:api|bug|code|coding|database|debug|dokumen|document|error|exception|file|invoice|java|javascript|kode|medis|medical|doctor|dokter|diagnosis|disease|penyakit|medicine|obat|hospital|pdf|program|python|server|skrip|script|stack trace|syntax|compiler|runtime|tabel|table|teknis|technical|typescript|hukum|legal|lawyer|pengacara|polisi|court|lawsuit|uang|finance|financial|keuangan|bank|debt|hutang|pajak|investasi|saham|analisis|analyze|rangkum|summari[sz]e|meninggal|wafat|kematian|berduka|grief|grieving|died|death|dead|bereavement|suicide|suicidal|self-harm|bunuh diri|menyakiti diri)\b/u;
  const academic = /\b(?:academic|assignment|belajar|exam|homework|kuis|latihan|mcqs?|multiple[- ]choice|pekerjaan rumah|pembahasan|pilihan ganda|quiz|schoolwork|soal|studies|study|studying|tugas|ujian)\b/u;
  const optionLabels = new Set([...text.matchAll(/(?:^|\s)([a-e])[.)]\s*\S/gu)].map(match => match[1]));
  if (serious.test(text) || academic.test(text) || optionLabels.size >= 2) return false;
  return /(?:\b(?:hai|halo|hello|hey|hi|pagi|siang|sore|malam|apa kabar|how are you|makasih|terima kasih|thanks|thank you|wkwk|haha|hehe|lol|senang|happy|sedih|sad|semangat|sayang|love|lucu|cute|dadah|bye)\b|[>^]-?\.<|[😊😁😂🥰😍😭😢😳💗💕✨👋])/u.test(text);
}

function isInsideCodeFence(lines, markerLineIndex) {
  let activeFence = null;
  for (let index = 0; index < markerLineIndex; index += 1) {
    const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[index]);
    if (!match) continue;
    const fence = match[1];
    if (activeFence === null) {
      activeFence = { marker: fence[0], length: fence.length };
      continue;
    }
    const isCloser = fence[0] === activeFence.marker
      && fence.length >= activeFence.length
      && match[2].trim() === '';
    if (isCloser) activeFence = null;
  }
  return activeFence !== null;
}
