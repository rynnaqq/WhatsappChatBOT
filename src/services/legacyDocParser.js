import WordExtractor from 'word-extractor';

const CFB_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const FAT_SECTOR = 0xfffffffd;
const DIFAT_SECTOR = 0xfffffffc;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const extractor = new WordExtractor();

function invalidDocument() {
  const error = new Error('Unable to read this legacy Word document.');
  error.code = 'LEGACY_DOC_INVALID';
  return error;
}

function readUInt32(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) throw invalidDocument();
  return buffer.readUInt32LE(offset);
}

function parseCompoundFile(buffer) {
  if (buffer.length < 512 || !buffer.subarray(0, 8).equals(CFB_SIGNATURE)) {
    throw invalidDocument();
  }

  const majorVersion = buffer.readUInt16LE(26);
  const sectorShift = buffer.readUInt16LE(30);
  const miniSectorShift = buffer.readUInt16LE(32);
  const sectorSize = 2 ** sectorShift;
  const miniSectorSize = 2 ** miniSectorShift;
  if (
    buffer.readUInt16LE(28) !== 0xfffe
    || !((majorVersion === 3 && sectorShift === 9) || (majorVersion === 4 && sectorShift === 12))
    || miniSectorShift !== 6
    || buffer.readUInt32LE(56) !== 4096
    || buffer.length < sectorSize
    || (buffer.length - sectorSize) % sectorSize !== 0
  ) {
    throw invalidDocument();
  }

  const sectorCount = (buffer.length - sectorSize) / sectorSize;
  const fatSectorCount = readUInt32(buffer, 44);
  const firstDirectorySector = readUInt32(buffer, 48);
  const firstMiniFatSector = readUInt32(buffer, 60);
  const miniFatSectorCount = readUInt32(buffer, 64);
  const firstDifatSector = readUInt32(buffer, 68);
  const difatSectorCount = readUInt32(buffer, 72);
  if (fatSectorCount === 0 || fatSectorCount > sectorCount || difatSectorCount > sectorCount) {
    throw invalidDocument();
  }

  function sector(sectorId) {
    if (!Number.isInteger(sectorId) || sectorId < 0 || sectorId >= sectorCount) {
      throw invalidDocument();
    }
    const start = sectorSize + sectorId * sectorSize;
    return buffer.subarray(start, start + sectorSize);
  }

  const fatSectorIds = [];
  for (let index = 0; index < 109 && fatSectorIds.length < fatSectorCount; index += 1) {
    const sectorId = readUInt32(buffer, 76 + index * 4);
    if (sectorId !== FREE_SECTOR) fatSectorIds.push(sectorId);
  }

  let nextDifatSector = firstDifatSector;
  const seenDifat = new Set();
  const difatEntriesPerSector = sectorSize / 4 - 1;
  for (let index = 0; index < difatSectorCount; index += 1) {
    if (nextDifatSector === END_OF_CHAIN || seenDifat.has(nextDifatSector)) throw invalidDocument();
    seenDifat.add(nextDifatSector);
    const difat = sector(nextDifatSector);
    for (let entry = 0; entry < difatEntriesPerSector && fatSectorIds.length < fatSectorCount; entry += 1) {
      const sectorId = difat.readUInt32LE(entry * 4);
      if (sectorId !== FREE_SECTOR) fatSectorIds.push(sectorId);
    }
    nextDifatSector = difat.readUInt32LE(sectorSize - 4);
  }
  if (
    fatSectorIds.length !== fatSectorCount
    || new Set(fatSectorIds).size !== fatSectorIds.length
    || (difatSectorCount === 0 && firstDifatSector !== END_OF_CHAIN)
    || (difatSectorCount > 0 && nextDifatSector !== END_OF_CHAIN)
  ) {
    throw invalidDocument();
  }

  const fat = new Uint32Array(fatSectorCount * (sectorSize / 4));
  let fatIndex = 0;
  for (const sectorId of fatSectorIds) {
    const fatSector = sector(sectorId);
    for (let offset = 0; offset < sectorSize; offset += 4) {
      fat[fatIndex] = fatSector.readUInt32LE(offset);
      fatIndex += 1;
    }
  }

  function followChain(startSector, allocationTable, maximumSector) {
    const chain = [];
    const seen = new Set();
    let current = startSector;
    while (current !== END_OF_CHAIN) {
      if (
        current === FREE_SECTOR || current === FAT_SECTOR || current === DIFAT_SECTOR
        || current >= maximumSector || current >= allocationTable.length || seen.has(current)
      ) {
        throw invalidDocument();
      }
      seen.add(current);
      chain.push(current);
      if (chain.length > maximumSector) throw invalidDocument();
      current = allocationTable[current];
    }
    return chain;
  }

  const directoryChain = followChain(firstDirectorySector, fat, sectorCount);
  if (directoryChain.length === 0) throw invalidDocument();
  const directory = Buffer.concat(directoryChain.map(sector));
  const entries = [];
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const type = directory.readUInt8(offset + 66);
    if (type === 0) continue;
    const nameLength = directory.readUInt16LE(offset + 64);
    if (nameLength < 2 || nameLength > 64 || nameLength % 2 !== 0) throw invalidDocument();
    const sizeValue = directory.readBigUInt64LE(offset + 120);
    if (sizeValue > MAX_SAFE_BIGINT || (majorVersion === 3 && directory.readUInt32LE(offset + 124) !== 0)) {
      throw invalidDocument();
    }
    entries.push({
      name: directory.toString('utf16le', offset, offset + nameLength - 2),
      type,
      startSector: directory.readUInt32LE(offset + 116),
      size: Number(sizeValue),
    });
  }

  const roots = entries.filter((entry) => entry.type === 5);
  const wordStreams = entries.filter((entry) => entry.type === 2 && entry.name.toLowerCase() === 'worddocument');
  if (roots.length !== 1 || wordStreams.length !== 1) throw invalidDocument();
  const root = roots[0];

  function readRegularStream(entry, prefixLimit = entry.size) {
    if (entry.size === 0) return Buffer.alloc(0);
    const chain = followChain(entry.startSector, fat, sectorCount);
    const requiredSectors = Math.ceil(entry.size / sectorSize);
    if (chain.length !== requiredSectors || entry.size > chain.length * sectorSize) throw invalidDocument();
    const outputLength = Math.min(entry.size, prefixLimit);
    const output = Buffer.allocUnsafe(outputLength);
    let written = 0;
    for (const sectorId of chain) {
      if (written >= outputLength) break;
      const source = sector(sectorId);
      const length = Math.min(source.length, outputLength - written);
      source.copy(output, written, 0, length);
      written += length;
    }
    return output;
  }

  let miniFat;
  let miniStream;
  function prepareMiniStreams() {
    if (miniFat !== undefined) return;
    miniStream = readRegularStream(root);
    if (miniFatSectorCount === 0) {
      if (firstMiniFatSector !== END_OF_CHAIN) throw invalidDocument();
      miniFat = new Uint32Array(0);
      return;
    }
    if (firstMiniFatSector === END_OF_CHAIN || root.size === 0) {
      throw invalidDocument();
    }
    const chain = followChain(firstMiniFatSector, fat, sectorCount);
    if (chain.length !== miniFatSectorCount) throw invalidDocument();
    miniFat = new Uint32Array(chain.length * (sectorSize / 4));
    let index = 0;
    for (const sectorId of chain) {
      const data = sector(sectorId);
      for (let offset = 0; offset < sectorSize; offset += 4) {
        miniFat[index] = data.readUInt32LE(offset);
        index += 1;
      }
    }
  }

  function readStream(entry, prefixLimit = entry.size) {
    if (entry.size >= 4096) return readRegularStream(entry, prefixLimit);
    if (entry.size === 0) return Buffer.alloc(0);
    prepareMiniStreams();
    const miniSectorCount = Math.ceil(root.size / miniSectorSize);
    const chain = followChain(entry.startSector, miniFat, miniSectorCount);
    if (chain.length !== Math.ceil(entry.size / miniSectorSize)) throw invalidDocument();
    const outputLength = Math.min(entry.size, prefixLimit);
    const output = Buffer.allocUnsafe(outputLength);
    let written = 0;
    for (const sectorId of chain) {
      if (written >= outputLength) break;
      const start = sectorId * miniSectorSize;
      const length = Math.min(miniSectorSize, outputLength - written);
      if (start + length > miniStream.length) throw invalidDocument();
      miniStream.copy(output, written, start, start + length);
      written += length;
    }
    return output;
  }

  prepareMiniStreams();

  const wordDocument = readStream(wordStreams[0], 4096);
  if (wordDocument.length < 32 || wordDocument.readUInt16LE(0) !== 0xa5ec) throw invalidDocument();

  const flags = wordDocument.readUInt16LE(0x0a);
  if ((flags & 0x0100) !== 0 || (flags & 0x8000) !== 0) throw invalidDocument();

  const tableName = (flags & 0x0200) !== 0 ? '1table' : '0table';
  const tableStreams = entries.filter((entry) => entry.type === 2 && entry.name.toLowerCase() === tableName);
  if (tableStreams.length !== 1 || readStream(tableStreams[0], 1).length !== 1) throw invalidDocument();
}

function normalizeSection(value) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[^\S\n\t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectText(document) {
  const sections = [
    ['Body', document.getBody()],
    ['Headers', document.getHeaders({ includeFooters: false })],
    ['Footers', document.getFooters()],
    ['Footnotes', document.getFootnotes()],
    ['Endnotes', document.getEndnotes()],
    ['Text boxes', document.getTextboxes({ includeHeadersAndFooters: false })],
    ['Header and footer text boxes', document.getTextboxes({ includeBody: false })],
    ['Comments', document.getAnnotations()],
  ];
  const seen = new Set();
  const output = [];
  for (const [label, rawText] of sections) {
    const text = normalizeSection(rawText);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(`[${label}]\n${text}`);
  }
  return output.join('\n\n');
}

function truncateByCodePoint(text, maxChars) {
  let count = 0;
  let end = 0;
  for (const character of text) {
    if (count === maxChars) return { text: text.slice(0, end), truncated: true };
    end += character.length;
    count += 1;
  }
  return { text, truncated: false };
}

export async function parseLegacyDoc(buffer, { maxChars = 60_000 } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Legacy DOC input must be a Buffer.');
  if (!Number.isSafeInteger(maxChars) || maxChars < 0) {
    throw new RangeError('maxChars must be a non-negative safe integer.');
  }

  try {
    parseCompoundFile(buffer);
    const document = await extractor.extract(buffer);
    return truncateByCodePoint(collectText(document), maxChars);
  } catch {
    throw invalidDocument();
  }
}
