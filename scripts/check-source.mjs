import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['server.mjs'];
for (const folder of ['bin', 'lib', 'scripts', 'public', 'test']) {
  for (const entry of await readdir(resolve(root, folder), { withFileTypes: true })) {
    if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) files.push(`${folder}/${entry.name}`);
  }
}
for (const name of files) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, name)], { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw result.error || new Error(`Sintaxe inválida: ${name}`);
}
console.log(`${files.length} arquivos JavaScript verificados.`);
