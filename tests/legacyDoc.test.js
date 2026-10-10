import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { parseLegacyDoc } from '../src/services/legacyDocParser.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'legacy-doc');
const CFB_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const FIXTURE_FIB_OFFSET = 512;

async function fixture(name) {
  return readFile(path.join(FIXTURES, name));
}

function withFibFlag(buffer, flag) {
  const changed = Buffer.from(buffer);
  assert.equal(changed.readUInt16LE(FIXTURE_FIB_OFFSET), 0xa5ec);
  changed.writeUInt16LE(changed.readUInt16LE(FIXTURE_FIB_OFFSET + 0x0a) | flag, FIXTURE_FIB_OFFSET + 0x0a);
  return changed;
}

function parseInIsolatedWorker(buffer, timeoutMs = 1_000) {
  const parserUrl = new URL('../src/services/legacyDocParser.js', import.meta.url).href;
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.parserUrl)
        .then(({ parseLegacyDoc }) => parseLegacyDoc(Buffer.from(workerData.buffer)))
        .then(() => parentPort.postMessage({ status: 'resolved' }))
        .catch((error) => parentPort.postMessage({
          status: 'rejected',
          code: error?.code,
          message: error?.message,
        }));
    `, {
      eval: true,
      workerData: { buffer, parserUrl },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ status: 'timeout' });
    }, timeoutMs);
    worker.once('message', (message) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(message);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      void worker.terminate();
      reject(error);
    });
  });
}

function withCyclicDeclaredMiniFat(buffer) {
  const changed = Buffer.from(buffer);
  const sectorSize = 2 ** changed.readUInt16LE(30);
  const fatSector = changed.readUInt32LE(76);
  const firstMiniFatSector = changed.readUInt32LE(60);
  const secondMiniFatSector = firstMiniFatSector + 1;
  const fatOffset = (fatSector + 1) * sectorSize;
  changed.writeUInt32LE(2, 64);
  changed.writeUInt32LE(secondMiniFatSector, fatOffset + firstMiniFatSector * 4);
  changed.writeUInt32LE(firstMiniFatSector, fatOffset + secondMiniFatSector * 4);
  return changed;
}

function withCyclicRootMiniStream(buffer) {
  const changed = Buffer.from(buffer);
  const sectorSize = 2 ** changed.readUInt16LE(30);
  const fatSector = changed.readUInt32LE(76);
  const directorySector = changed.readUInt32LE(48);
  const rootEntryOffset = (directorySector + 1) * sectorSize;
  const rootMiniStreamSector = changed.readUInt32LE(rootEntryOffset + 116);
  const fatOffset = (fatSector + 1) * sectorSize;
  changed.writeUInt32LE(rootMiniStreamSector, fatOffset + rootMiniStreamSector * 4);
  return changed;
}

test('extracts Unicode body text and preserves table cell separators from real binary DOC files', async () => {
  const table = await parseLegacyDoc(await fixture('table.doc'));
  assert.match(table.text, /^\[Body\]/);
  assert.match(table.text, /License\tGPL v3\.0\tLGPL v3\.0\tBSD\tMIT \(X11\)\tApache v2\.0/);
  assert.equal(table.truncated, false);

  const unicode = await parseLegacyDoc(await fixture('unicode-header-footer.doc'));
  assert.match(unicode.text, /GBP - £/);
  assert.match(unicode.text, /EUR - €/);
  assert.match(unicode.text, /Molière/);
});

test('labels headers, footers, notes, and text boxes without duplicating aggregate text', async () => {
  const headed = await parseLegacyDoc(await fixture('unicode-header-footer.doc'));
  assert.match(headed.text, /\[Headers\]\nThis is a simple header, with a € euro symbol in it\./);
  assert.match(headed.text, /\[Footers\]\nThe footer, with Molière, has Unicode in it\./);

  const notes = await parseLegacyDoc(await fixture('notes.doc'));
  assert.match(notes.text, /\[Footnotes\]\nThis is a footnote/);
  assert.match(notes.text, /\[Endnotes\]\nThis is an endnote/);

  const textboxes = await parseLegacyDoc(await fixture('textboxes.doc'));
  assert.match(textboxes.text, /\[Text boxes\]\nFirst text box, regular/);
  assert.match(textboxes.text, /\[Header and footer text boxes\]\nHeader box 2/);
  assert.equal(textboxes.text.match(/First text box, regular/g)?.length, 1);
  assert.equal(textboxes.text.match(/Header box 2/g)?.length, 1);
});

test('rejects a full-signature spoof and a truncated compound file with one safe error', async () => {
  const spoof = Buffer.alloc(1024);
  CFB_SIGNATURE.copy(spoof);
  spoof.writeUInt16LE(0xa5ec, 512);

  for (const buffer of [spoof, (await fixture('table.doc')).subarray(0, 1024)]) {
    await assert.rejects(
      parseLegacyDoc(buffer),
      (error) => error?.code === 'LEGACY_DOC_INVALID'
        && error.message === 'Unable to read this legacy Word document.',
    );
  }
});

test('rejects cyclic MiniFAT and root mini-stream chains without entering the dependency walker', async () => {
  const original = await fixture('table.doc');
  for (const malformed of [
    withCyclicDeclaredMiniFat(original),
    withCyclicRootMiniStream(original),
  ]) {
    const outcome = await parseInIsolatedWorker(malformed);
    assert.deepEqual(outcome, {
      status: 'rejected',
      code: 'LEGACY_DOC_INVALID',
      message: 'Unable to read this legacy Word document.',
    });
  }
});

test('rejects encrypted and obfuscated Word FIBs before extraction', async () => {
  const original = await fixture('table.doc');
  for (const flag of [0x0100, 0x8000]) {
    await assert.rejects(
      parseLegacyDoc(withFibFlag(original, flag)),
      (error) => error?.code === 'LEGACY_DOC_INVALID'
        && error.message === 'Unable to read this legacy Word document.',
    );
  }
});

test('rejects a non-Word FIB inside an otherwise valid compound file', async () => {
  const changed = Buffer.from(await fixture('table.doc'));
  changed.writeUInt16LE(0xffff, FIXTURE_FIB_OFFSET);

  await assert.rejects(
    parseLegacyDoc(changed),
    (error) => error?.code === 'LEGACY_DOC_INVALID'
      && error.message === 'Unable to read this legacy Word document.',
  );
});

test('truncates the complete sectioned text at a Unicode character boundary', async () => {
  const result = await parseLegacyDoc(await fixture('table.doc'), { maxChars: 81 });
  assert.equal(Array.from(result.text).length, 81);
  assert.equal(result.truncated, true);
  assert.equal(/[\uD800-\uDBFF]$/.test(result.text), false);

  const empty = await parseLegacyDoc(await fixture('table.doc'), { maxChars: 0 });
  assert.deepEqual(empty, { text: '', truncated: true });
});

test('requires an in-memory Buffer and a non-negative integer text limit', async () => {
  await assert.rejects(parseLegacyDoc('table.doc'), TypeError);
  await assert.rejects(parseLegacyDoc(Buffer.alloc(0), { maxChars: -1 }), RangeError);
  await assert.rejects(parseLegacyDoc(Buffer.alloc(0), { maxChars: 2.5 }), RangeError);
});
