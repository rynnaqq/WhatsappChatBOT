import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function filesIn(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(full));
    else if (entry.name.endsWith('.js')) result.push(full);
  }
  return result;
}
let count = 0;
for (const root of ['src', 'scripts', 'tests']) {
  for (const file of await filesIn(root)) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) { console.error(`${file}:\n${result.stderr || result.error?.message || 'Syntax check failed.'}`); process.exitCode = 1; }
    count += 1;
  }
}
if (!process.exitCode) console.log(`Syntax checks passed for ${count} JavaScript files.`);
