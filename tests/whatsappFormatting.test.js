import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeWhatsAppBold } from '../src/services/whatsappFormatting.js';

test('Markdown bold labels and answer options use one WhatsApp asterisk on each side', () => {
  for (const [input, expected] of [
    ['**Jawaban:** B', '*Jawaban:* B'],
    ['**Jawaban**: **B. Fotosintesis**', '*Jawaban*: *B. Fotosintesis*'],
    ['**Penjelasan**. **Jawaban**.', '*Penjelasan*. *Jawaban*.'],
    ['1. **Jawaban: B**\n\n**Penjelasan:** Karena benar.', '1. *Jawaban: B*\n\n*Penjelasan:* Karena benar.'],
    ['(**Jawaban:** B), **Penjelasan.**', '(*Jawaban:* B), *Penjelasan.*'],
    ['**Jawaban: `B`** dan **teks**.', '*Jawaban: `B`* dan *teks*.'],
    ['**答案：B**', '*答案：B*'],
  ]) {
    assert.equal(normalizeWhatsAppBold(input), expected);
    assert.equal(normalizeWhatsAppBold(expected), expected, 'Formatting must be idempotent');
  }
});

test('native formatting, literal stars, powers, paths and malformed delimiters stay unchanged', () => {
  for (const input of [
    '*Jawaban:* B\n\n*Penjelasan:* Teks _miring_ dan ~coret~.',
    '2**3 + 4**5 = 1032; x**y**z',
    '**/*.js; src/**/test/**; **/*.ts',
    '\\**literal** dan \\**contoh\\**',
    '***\n* * *\n****\n** **',
    '**belum ditutup\nbaris berikutnya',
    '** ada spasi **',
    '***campuran bold dan miring***',
    'Nilai = 2 * 3. Emoji 🌸 dan kaomoji >.< tetap.',
  ]) assert.equal(normalizeWhatsAppBold(input), input);
});

test('grouped powers and trailing globs never become bold delimiters', () => {
  for (const expression of [
    '(-2)**(3) + (-4)**(2)',
    '(a + b)**(c + d) + (x + y)**(z + w)',
    '(-2)**-3 + (-4)**-2',
    'x**-2 + y**-3',
    '(2 + 2)**.5 + (5 + 4)**.5',
    '2**.5 + 3**.5',
    '|x|**(2) + |y|**(3)',
    '\u{1D465}**(-2) + \u{1D466}**(-3)',
    'src/**, test/**/fixtures',
    'Use src/**, lib/**, tests/** for matching.',
    'src\\**, test\\**\\fixtures',
  ]) {
    assert.equal(normalizeWhatsAppBold(expression), expression);
    assert.equal(normalizeWhatsAppBold(`**Jawaban:** ${expression}`), `*Jawaban:* ${expression}`);
    assert.equal(normalizeWhatsAppBold(`**Rumus ${expression}**`), `*Rumus ${expression}*`);
  }
});

test('inline code, multiline code spans and indented code remain byte-identical', () => {
  const input = '**Judul**\r\n`**Jawaban:**` dan ``kode `**contoh**` ``\r\n    **kode**\r\n\t**kode juga**\r\n`kode\r\n**literal**\r\n`\r\n**Penjelasan:** selesai.';
  const expected = '*Judul*\r\n`**Jawaban:**` dan ``kode `**contoh**` ``\r\n    **kode**\r\n\t**kode juga**\r\n`kode\r\n**literal**\r\n`\r\n*Penjelasan:* selesai.';
  assert.equal(normalizeWhatsAppBold(input), expected);
  assert.equal(normalizeWhatsAppBold('`unclosed **code**\n**still code**'), '`unclosed **code**\n**still code**');
});

test('closed code spans release following prose even with indentation or three backticks', () => {
  for (const code of [
    '`start\n    **literal**\n    `',
    '```**literal**```',
    '```**literal**``` and `**code**`',
  ]) assert.equal(normalizeWhatsAppBold(`${code}\n**Jawaban:** B`), `${code}\n*Jawaban:* B`);
});

test('fenced code, longer fences, quoted fences and unfinished fences preserve their contents', () => {
  for (const code of [
    '```js\nconst label = "**Jawaban:**";\n```',
    '~~~~text\n**literal**\n~~~\n**still literal**\n~~~~',
    '````markdown\n```\n**literal**\n```\n````',
    '> ```text\n> **literal**\n> ```',
    '>   > ~~~text\n>   > **literal**\n>   > ~~~',
  ]) {
    assert.equal(normalizeWhatsAppBold(`**Sebelum**\n${code}\n**Sesudah**`), `*Sebelum*\n${code}\n*Sesudah*`);
  }
  const unfinished = '**Judul**\n```text\n**literal**\nmore **code**';
  assert.equal(normalizeWhatsAppBold(unfinished), '*Judul*\n```text\n**literal**\nmore **code**');
});

test('only matched prose delimiters change while surrounding whitespace and line endings survive', () => {
  const input = '  **Jawaban:** B\r\n\r\n**Penjelasan:** x * y.  \r\n';
  const expected = '  *Jawaban:* B\r\n\r\n*Penjelasan:* x * y.  \r\n';
  assert.equal(normalizeWhatsAppBold(input), expected);
  assert.equal(normalizeWhatsAppBold('**unclosed ... **Jawaban:** B'), '**unclosed ... *Jawaban:* B');
});
