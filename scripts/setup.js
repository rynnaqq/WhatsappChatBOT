import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const destination = path.resolve('.env');
const contents = [
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

try {
  await writeFile(destination, contents, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with a random dashboard password and session secret.');
  console.log('Read DASHBOARD_PASSWORD in .env to sign in, then run npm start.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env already exists; your settings were kept. Run npm start to use it.');
  else { console.error('Could not create .env. Check permissions in the project directory.'); process.exitCode = 1; }
}
