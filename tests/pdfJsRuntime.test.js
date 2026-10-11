import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const projectRuntimePath = fileURLToPath(new URL('../src/services/pdfJsRuntime.js', import.meta.url));
const installedPdfPath = fileURLToPath(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
const installedPdfSource = await readFile(installedPdfPath, 'utf8');
const fixtureBase = fileURLToPath(new URL('../.superpowers/model-debug/', import.meta.url));

async function runtimeFixture({
  version = '6.2.108',
  source = installedPdfSource,
} = {}) {
  await mkdir(fixtureBase, { recursive: true });
  const root = await mkdtemp(join(fixtureBase, 'pdfjs-runtime-test-'));
  const runtimePath = join(root, 'src', 'pdfJsRuntime.js');
  const buildDirectory = join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
  await mkdir(dirname(runtimePath), { recursive: true });
  await mkdir(buildDirectory, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(
    join(root, 'node_modules', 'pdfjs-dist', 'package.json'),
    JSON.stringify({ name: 'pdfjs-dist', version, type: 'module' }),
  );
  await writeFile(join(buildDirectory, 'pdf.mjs'), source);
  await copyFile(projectRuntimePath, runtimePath);
  const runtime = await import(`${pathToFileURL(runtimePath).href}?fixture=${Date.now()}-${Math.random()}`);
  return {
    root,
    runtimePath,
    buildDirectory,
    runtime,
    cleanup: () => {
      const relativeRoot = relative(resolve(fixtureBase), resolve(root));
      if (!relativeRoot || relativeRoot.startsWith('..') || isAbsolute(relativeRoot)) {
        throw new Error('Refusing to clean a PDF.js runtime fixture outside its fixture directory.');
      }
      return rm(root, { recursive: true, force: true });
    },
  };
}

test('derives one verified content-addressed PDF.js runtime under concurrent loads', async () => {
  const fixture = await runtimeFixture();
  try {
    const originalPath = join(fixture.buildDirectory, 'pdf.mjs');
    const originalHash = createHash('sha256').update(await readFile(originalPath)).digest('hex');
    const independentRuntime = await import(`${pathToFileURL(fixture.runtimePath).href}?independent=${Date.now()}-${Math.random()}`);
    const modules = await Promise.all([
      ...Array.from({ length: 4 }, () => fixture.runtime.loadPdfJsRuntime()),
      ...Array.from({ length: 4 }, () => independentRuntime.loadPdfJsRuntime()),
    ]);
    for (const module of modules) assert.strictEqual(module, modules[0]);
    assert.equal(typeof modules[0].getDocument, 'function');

    const entries = await readdir(fixture.buildDirectory);
    const derived = entries.filter(entry => /^pdf\.chatbot-[a-f0-9]{64}\.mjs$/.test(entry));
    assert.equal(derived.length, 1);
    assert.equal(entries.some(entry => entry.includes('.tmp-')), false);

    const derivedPath = join(fixture.buildDirectory, derived[0]);
    const derivedSource = await readFile(derivedPath, 'utf8');
    assert.ok(derivedSource.startsWith('/**\n * @licstart'));
    assert.ok(derivedSource.includes('NOTICE: This file was modified by whatsapp-ai-chatbot'));
    assert.equal(derivedSource.includes('const FULL_CHUNK_HEIGHT = 16;'), false);
    assert.equal(derivedSource.split('const FULL_CHUNK_HEIGHT = 256;').length - 1, 1);
    const derivedHash = createHash('sha256').update(derivedSource).digest('hex');
    assert.equal(derived[0], `pdf.chatbot-${derivedHash}.mjs`);
    assert.equal(createHash('sha256').update(await readFile(originalPath)).digest('hex'), originalHash);

    const modifiedAt = (await stat(derivedPath)).mtimeMs;
    assert.strictEqual(await fixture.runtime.loadPdfJsRuntime(), modules[0]);
    assert.equal((await stat(derivedPath)).mtimeMs, modifiedAt);
  } finally {
    await fixture.cleanup();
  }
});

test('rejects a corrupted existing derived runtime before importing it', async () => {
  const fixture = await runtimeFixture();
  try {
    await fixture.runtime.loadPdfJsRuntime();
    const derived = (await readdir(fixture.buildDirectory))
      .find(entry => /^pdf\.chatbot-[a-f0-9]{64}\.mjs$/.test(entry));
    assert.ok(derived);
    await writeFile(join(fixture.buildDirectory, derived), 'corrupted derived runtime');
    const independentRuntime = await import(`${pathToFileURL(fixture.runtimePath).href}?corrupt=${Date.now()}-${Math.random()}`);
    await assert.rejects(
      independentRuntime.loadPdfJsRuntime(),
      error => error?.name === 'PdfJsRuntimeError'
        && error?.code === 'PDFJS_RUNTIME_INTEGRITY'
        && error?.check === 'derived-hash',
    );
  } finally {
    await fixture.cleanup();
  }
});

for (const [name, options, check] of [
  [
    'rejects an unsupported PDF.js version without exposing filesystem details',
    { version: '6.2.109' },
    'package-version',
  ],
  [
    'rejects altered PDF.js source without writing a derived module',
    { source: `${installedPdfSource}\n// altered` },
    'source-hash',
  ],
  [
    'rejects an ambiguous PDF.js patch marker',
    { source: installedPdfSource.replace('const FULL_CHUNK_HEIGHT = 16;', 'const FULL_CHUNK_HEIGHT = 16;\nconst FULL_CHUNK_HEIGHT = 16;') },
    'source-marker',
  ],
]) {
  test(name, async () => {
    const fixture = await runtimeFixture(options);
    try {
      await assert.rejects(
        fixture.runtime.loadPdfJsRuntime(),
        error => error?.name === 'PdfJsRuntimeError'
          && error?.code === 'PDFJS_RUNTIME_INTEGRITY'
          && error?.check === check
          && error?.message === 'The PDF rendering runtime is unavailable.'
          && !error.message.includes(fixture.root),
      );
      const entries = await readdir(fixture.buildDirectory);
      assert.deepEqual(entries, ['pdf.mjs']);
    } finally {
      await fixture.cleanup();
    }
  });
}
