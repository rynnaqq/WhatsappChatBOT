import { randomBytes } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const destination = path.resolve('secrets.env');

async function setup() {
  try {
    await access(destination);
    console.log('secrets.env already exists; your settings were kept. Run npm start to use it.');
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let legacyContents;
  try {
    legacyContents = await readFile(path.resolve('.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const contents = legacyContents ?? [
    '# Generated local credentials. Keep this file private.',
    'PORT=3000',
    'HOST=127.0.0.1',
    `DASHBOARD_PASSWORD=${randomBytes(24).toString('base64url')}`,
    `SESSION_SECRET=${randomBytes(48).toString('base64url')}`,
    'LOG_LEVEL=info',
    'STORAGE_DIR=./storage',
    'TRUST_PROXY=false',
    'MAX_TOKENS_CEILING=32768',
    '',
  ].join('\n');

  await writeFile(destination, contents, { flag: 'wx', mode: 0o600 });
  console.log(legacyContents === undefined
    ? 'Created secrets.env with a random dashboard password and session secret.'
    : 'Created secrets.env using your existing credentials and settings from .env.');
  console.log('Read DASHBOARD_PASSWORD in secrets.env to sign in, then run npm start.');
}

setup().catch((error) => {
  if (error.code === 'EEXIST') console.log('secrets.env already exists; your settings were kept. Run npm start to use it.');
  else { console.error('Could not create secrets.env. Check permissions in the project directory.'); process.exitCode = 1; }
});
