import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { loadEnv } from '../src/config/env.js';

test('setup creates valid private credentials without printing or overwriting them', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wabot-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../scripts/setup.js', import.meta.url));
  const run = () => spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8', windowsHide: true });
  const first = run();
  assert.equal(first.status, 0);
  const source = await readFile(path.join(directory, 'secrets.env'), 'utf8');
  const values = dotenv.parse(source);
  loadEnv(values);
  assert.equal(first.stdout.includes(values.DASHBOARD_PASSWORD), false);
  assert.equal(first.stdout.includes(values.SESSION_SECRET), false);
  assert.equal(run().status, 0);
  assert.equal(await readFile(path.join(directory, 'secrets.env'), 'utf8'), source);
  await assert.rejects(readFile(path.join(directory, '.env')), { code: 'ENOENT' });
});

test('setup copies legacy credentials into secrets.env without rotating them', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wabot-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = 'DASHBOARD_PASSWORD=legacy-password-123\r\nSESSION_SECRET=' + 'a'.repeat(64) + '\r\nPORT=33506\r\n';
  await writeFile(path.join(directory, '.env'), source);
  const script = fileURLToPath(new URL('../scripts/setup.js', import.meta.url));
  const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8', windowsHide: true });

  assert.equal(result.status, 0);
  assert.equal(await readFile(path.join(directory, 'secrets.env'), 'utf8'), source);
  assert.equal(await readFile(path.join(directory, '.env'), 'utf8'), source);
  assert.equal(result.stdout.includes('legacy-password-123'), false);
  assert.equal(result.stdout.includes('a'.repeat(64)), false);
});

test('setup preserves an existing secrets.env when legacy .env contains different credentials', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wabot-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = 'DASHBOARD_PASSWORD=primary-password-123\nSESSION_SECRET=' + 'b'.repeat(64) + '\n';
  await writeFile(path.join(directory, 'secrets.env'), source);
  await writeFile(path.join(directory, '.env'), 'SESSION_SECRET=legacy-must-not-replace-primary\n');
  const script = fileURLToPath(new URL('../scripts/setup.js', import.meta.url));
  const result = spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8', windowsHide: true });

  assert.equal(result.status, 0);
  assert.equal(await readFile(path.join(directory, 'secrets.env'), 'utf8'), source);
});
