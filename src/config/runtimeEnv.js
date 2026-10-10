import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';

const defaultFilePath = new URL('../../secrets.env', import.meta.url);
const legacyFilePath = new URL('../../.env', import.meta.url);

export function readRuntimeEnv({ env = process.env, filePath = defaultFilePath } = {}) {
  let fileValues = {};
  const filePaths = filePath === defaultFilePath ? [defaultFilePath, legacyFilePath] : [filePath];
  for (const candidate of filePaths) {
    try {
      fileValues = dotenv.parse(readFileSync(candidate, 'utf8'));
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error('Configuration error:\nUnable to read runtime environment file.');
      }
    }
  }

  const merged = { ...fileValues };
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') merged[name] = value;
  }

  // Wings exports the current primary allocation; a stored PORT may be stale.
  if (env.SERVER_PORT !== undefined && env.SERVER_PORT !== '') {
    merged.PORT = env.SERVER_PORT;
    if (env.HOST === undefined || env.HOST === '') merged.HOST = '0.0.0.0';
  }
  return merged;
}
