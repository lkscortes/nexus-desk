import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookConfig } from '../lib/codex-hooks.mjs';
import { resolveDataDir } from '../lib/paths.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supplied = process.argv.indexOf('--target');
const target = supplied >= 0 ? resolve(process.argv[supplied + 1]) : resolve(process.env.CODEX_HOME || resolve(homedir(), '.codex'), 'hooks.json');
let existing = {}, present = false;
try { existing = JSON.parse(await readFile(target, 'utf8')); present = true; } catch (e) { if (e.code !== 'ENOENT') throw new Error('hooks.json inválido; instalação cancelada para preservar o arquivo.'); }
if (!existing || typeof existing !== 'object' || Array.isArray(existing) || (existing.hooks && (typeof existing.hooks !== 'object' || Array.isArray(existing.hooks)))) throw new Error('Formato de hooks inválido.');
const dataDir = resolveDataDir();
const addition = hookConfig(process.execPath, resolve(root, 'scripts/codex-hook.mjs'));
for (const groups of Object.values(addition.hooks)) for (const group of groups) for (const hook of group.hooks) hook.command += ` --data-dir \"${dataDir.replaceAll('\\', '/')}\"`;
const next = structuredClone(existing); next.hooks ||= {};
for (const [event, groups] of Object.entries(addition.hooks)) {
  const prior = next.hooks[event] || [];
  if (!Array.isArray(prior)) throw new Error(`Configuração inválida em ${event}.`);
  // Replace only this installation's own handlers; preserve other integrations.
  const owned = resolve(root, 'scripts/codex-hook.mjs').replaceAll('\\', '/');
  next.hooks[event] = prior.map(g => ({ ...g, hooks: g.hooks.filter(h => !String(h.command || '').replaceAll('\\', '/').includes(owned)) })).filter(g => g.hooks.length).concat(groups);
}
if (process.argv.includes('--preview')) {
  await writeFile(resolve(root, 'codex-hooks.preview.json'), JSON.stringify(next, null, 2));
  console.log('Prévia criada: codex-hooks.preview.json. Nenhuma configuração Codex foi alterada.');
} else if (present && JSON.stringify(existing) === JSON.stringify(next)) {
  console.log('Hooks Nexus já configurados.');
} else {
  await mkdir(dirname(target), { recursive: true });
  if (present) { await mkdir(resolve(dataDir, 'backups'), { recursive: true }); await copyFile(target, resolve(dataDir, 'backups', `codex-hooks-backup-${Date.now()}.json`)); }
  await writeFile(target + '.nexus-tmp', JSON.stringify(next, null, 2));
  await rename(target + '.nexus-tmp', target);
  console.log(`Hooks instalados em ${target}. Revise e confie nos hooks no Codex; não foi aplicado bypass de confiança.`);
}
