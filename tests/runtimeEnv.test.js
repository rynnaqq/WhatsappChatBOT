import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from '../src/config/env.js';
import { readRuntimeEnv } from '../src/config/runtimeEnv.js';

const validPassword = 'operator-password-123';
const validSecret = 'a'.repeat(64);

async function temporaryDirectory() {
  return mkdtemp(path.join(os.tmpdir(), 'whatsapp-runtime-env-'));
}

test('blank exported credentials fall back to valid values in the env file', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, '.env');
  await writeFile(filePath, `DASHBOARD_PASSWORD=${validPassword}\nSESSION_SECRET=${validSecret}\nPORT=33506\n`);
  const exported = { DASHBOARD_PASSWORD: '', SESSION_SECRET: '', PORT: '' };

  const raw = readRuntimeEnv({ env: exported, filePath });
  const config = loadEnv(raw);

  assert.equal(config.dashboardPassword, validPassword);
  assert.equal(config.sessionSecret, validSecret);
  assert.equal(config.port, 33506);
  assert.deepEqual(exported, { DASHBOARD_PASSWORD: '', SESSION_SECRET: '', PORT: '' });
});

test('a non-empty exported secret wins and remains subject to validation', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, '.env');
  await writeFile(filePath, `DASHBOARD_PASSWORD=${validPassword}\nSESSION_SECRET=${validSecret}\n`);

  const raw = readRuntimeEnv({
    env: { DASHBOARD_PASSWORD: validPassword, SESSION_SECRET: 'short' },
    filePath,
  });

  assert.equal(raw.SESSION_SECRET, 'short');
  assert.throws(() => loadEnv(raw), /SESSION_SECRET must contain at least 32 characters/);
});

test('valid exported environment works when the env file is absent', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const exported = {
    DASHBOARD_PASSWORD: validPassword,
    SESSION_SECRET: validSecret,
    HOST: '0.0.0.0',
    PORT: '33506',
  };

  const config = loadEnv(readRuntimeEnv({ env: exported, filePath: path.join(directory, 'missing.env') }));

  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 33506);
});

test('file values, exported values and loader defaults merge without mutating inputs', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, '.env');
  await writeFile(filePath, `DASHBOARD_PASSWORD=${validPassword}\nSESSION_SECRET=${validSecret}\nHOST=0.0.0.0\nLOG_LEVEL=warn\n`);
  const exported = { PORT: '33506', LOG_LEVEL: 'debug' };
  const snapshot = { ...exported };

  const raw = readRuntimeEnv({ env: exported, filePath });
  const config = loadEnv(raw);

  assert.notEqual(raw, exported);
  assert.deepEqual(exported, snapshot);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 33506);
  assert.equal(config.logLevel, 'debug');
  assert.equal(config.sessionTtlMs, 43_200_000);
});

test('Pterodactyl allocation overrides stale ports and a local-only file host', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, '.env');
  const fileContents = `DASHBOARD_PASSWORD=${validPassword}\nSESSION_SECRET=${validSecret}\nPORT=3000\nHOST=127.0.0.1\n`;
  await writeFile(filePath, fileContents);
  const exported = { SERVER_PORT: '41234', PORT: '33506', SERVER_IP: '203.0.113.10' };
  const snapshot = { ...exported };

  const config = loadEnv(readRuntimeEnv({ env: exported, filePath }));

  assert.equal(config.port, 41234);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.dashboardPassword, validPassword);
  assert.equal(config.sessionSecret, validSecret);
  assert.deepEqual(exported, snapshot);
  assert.equal(await readFile(filePath, 'utf8'), fileContents);
});

test('a changed Pterodactyl allocation is used on the next configuration load', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, '.env');
  await writeFile(filePath, `DASHBOARD_PASSWORD=${validPassword}\nSESSION_SECRET=${validSecret}\nPORT=33506\n`);

  for (const allocatedPort of ['41234', '42345']) {
    const config = loadEnv(readRuntimeEnv({ env: { SERVER_PORT: allocatedPort }, filePath }));
    assert.equal(config.port, Number(allocatedPort));
    assert.equal(config.host, '0.0.0.0');
  }
});

test('Pterodactyl uses a public bind address unless an exported host is supplied', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, '.env');
  await writeFile(filePath, `DASHBOARD_PASSWORD=${validPassword}\nSESSION_SECRET=${validSecret}\nHOST=127.0.0.1\n`);

  for (const [host, expected] of [[undefined, '0.0.0.0'], ['', '0.0.0.0'], ['127.0.0.1', '127.0.0.1'], ['::', '::']]) {
    const config = loadEnv(readRuntimeEnv({ env: { SERVER_PORT: '41234', HOST: host }, filePath }));
    assert.equal(config.host, expected);
  }
});

test('a blank exported allocation or a file-only SERVER_PORT preserves local port selection', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, '.env');
  await writeFile(filePath, `DASHBOARD_PASSWORD=${validPassword}\nSESSION_SECRET=${validSecret}\nPORT=33506\nHOST=127.0.0.1\nSERVER_PORT=41234\n`);

  for (const [exported, expected] of [[{}, 33506], [{ SERVER_PORT: '' }, 33506], [{ SERVER_PORT: '', PORT: '42345' }, 42345]]) {
    const config = loadEnv(readRuntimeEnv({ env: exported, filePath }));
    assert.equal(config.port, expected);
    assert.equal(config.host, '127.0.0.1');
  }
});

test('an invalid allocation is rejected instead of listening on an unrelated fallback port', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, '.env');
  await writeFile(filePath, `DASHBOARD_PASSWORD=${validPassword}\nSESSION_SECRET=${validSecret}\nPORT=33506\n`);

  for (const allocatedPort of ['0', '65536', '41234abc', '-1', ' ']) {
    assert.throws(
      () => loadEnv(readRuntimeEnv({ env: { SERVER_PORT: allocatedPort }, filePath })),
      /PORT must be an integer from 1 to 65535/,
    );
  }
});

test('an unreadable env path produces a safe configuration error', async (t) => {
  const directory = await temporaryDirectory();
  t.after(() => rm(directory, { recursive: true, force: true }));

  assert.throws(
    () => readRuntimeEnv({
      env: { DASHBOARD_PASSWORD: 'do-not-reflect-password', SESSION_SECRET: 'do-not-reflect-secret' },
      filePath: directory,
    }),
    (error) => {
      assert.equal(error.message, 'Configuration error:\nUnable to read runtime environment file.');
      assert.equal(error.message.includes(directory), false);
      assert.equal(error.message.includes('do-not-reflect'), false);
      assert.equal(error.message.includes('EISDIR'), false);
      return true;
    },
  );
});

test('the default env path is anchored to the module project across working directories', async (t) => {
  const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
  const isolatedProject = await temporaryDirectory();
  const otherWorkingDirectory = await temporaryDirectory();
  const originalWorkingDirectory = process.cwd();
  t.after(async () => {
    process.chdir(originalWorkingDirectory);
    await Promise.all([
      rm(isolatedProject, { recursive: true, force: true }),
      rm(otherWorkingDirectory, { recursive: true, force: true }),
    ]);
  });
  const isolatedModuleDirectory = path.join(isolatedProject, 'src', 'config');
  await mkdir(isolatedModuleDirectory, { recursive: true });
  const isolatedModulePath = path.join(isolatedModuleDirectory, 'runtimeEnv.js');
  await copyFile(fileURLToPath(new URL('../src/config/runtimeEnv.js', import.meta.url)), isolatedModulePath);
  await cp(
    path.join(repositoryRoot, 'node_modules', 'dotenv'),
    path.join(isolatedProject, 'node_modules', 'dotenv'),
    { recursive: true },
  );
  await writeFile(path.join(isolatedProject, 'package.json'), '{"type":"module"}\n');
  await writeFile(
    path.join(isolatedProject, '.env'),
    `DASHBOARD_PASSWORD=${validPassword}\nSESSION_SECRET=${validSecret}\nPORT=33506\n`,
  );
  process.chdir(otherWorkingDirectory);
  const isolatedModule = await import(`${pathToFileURL(isolatedModulePath).href}?test=${Date.now()}`);

  const config = loadEnv(isolatedModule.readRuntimeEnv({ env: {} }));

  assert.equal(config.port, 33506);
  assert.equal(config.sessionSecret, validSecret);
});
