import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';

const defaultFilePath = new URL('../../.env', import.meta.url);

export function readRuntimeEnv({ env = process.env, filePath = defaultFilePath } = {}) {
  let fileValues = {};
  try {
    fileValues = dotenv.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error('Configuration error:\nUnable to read runtime environment file.');
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
