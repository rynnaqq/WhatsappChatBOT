import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function sourcePaths(directory, prefix = 'src') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourcePaths(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

test('Git distribution contains the complete application without runtime secrets', async (t) => {
  const available = spawnSync('git', ['--version'], { windowsHide: true });
  if (available.error?.code === 'ENOENT') {
    t.skip('Git is required to verify the deployment file set.');
    return;
  }
  assert.equal(available.status, 0);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wabot-distribution-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runGit = (args) => {
    const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.excludesFile=', '-C', directory, ...args], {
      encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout;
  };

  await cp(path.join(projectRoot, 'src'), path.join(directory, 'src'), { recursive: true });
  await cp(path.join(projectRoot, '.gitignore'), path.join(directory, '.gitignore'));
  await cp(path.join(projectRoot, 'secrets.env.example'), path.join(directory, 'secrets.env.example'));
  await mkdir(path.join(directory, 'storage', 'auth_info'), { recursive: true });
  await writeFile(path.join(directory, 'storage', 'auth_info', 'creds.json'), '{"fixture":"private"}');
  await writeFile(path.join(directory, '.env'), 'SESSION_SECRET=synthetic-runtime-secret\n');
  await writeFile(path.join(directory, 'secrets.env'), 'SESSION_SECRET=synthetic-canonical-secret\n');
  await writeFile(path.join(directory, 'secrets.env.backup'), 'SESSION_SECRET=synthetic-backup-secret\n');
  runGit(['init', '--quiet']);
  runGit(['add', '--all']);
  const staged = new Set(runGit(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean));
  const expected = (await sourcePaths(path.join(projectRoot, 'src'))).sort();

  assert.deepEqual([...staged].filter(file => file.startsWith('src/')).sort(), expected,
    'Every application module and dashboard asset must survive Git packaging.');
  assert.equal(staged.has('secrets.env.example'), true);
  assert.equal(staged.has('.env'), false);
  assert.equal(staged.has('secrets.env'), false);
  assert.equal(staged.has('secrets.env.backup'), false);
  assert.equal([...staged].some(file => file.startsWith('storage/')), false);
});
