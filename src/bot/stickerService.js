import { readFile } from 'node:fs/promises';
import { STICKER_IDS } from '../services/replyPersona.js';

const cached = new Map();

// Fixed local files only: model output never becomes an arbitrary path or URL.
export async function loadSticker(id) {
  if (!STICKER_IDS.includes(id)) return null;
  if (!cached.has(id)) {
    const file = new URL(`../../assets/stickers/${id}.webp`, import.meta.url);
    cached.set(id, readFile(file).then(buffer => {
      if (buffer.length > 100_000 || buffer.toString('ascii', 0, 4) !== 'RIFF'
        || buffer.toString('ascii', 8, 12) !== 'WEBP') {
        throw new Error('Invalid built-in sticker asset.');
      }
      return buffer;
    }).catch(error => {
      cached.delete(id);
      throw error;
    }));
  }
  return Buffer.from(await cached.get(id));
}
