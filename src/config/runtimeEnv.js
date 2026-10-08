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
  return merged;
}
