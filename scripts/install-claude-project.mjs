import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { claudeHookConfig } from '../lib/claude-observation.mjs';

// Explicit project only: never infer cwd and never write global Claude settings.
export async function installClaudeProject(project, { node = process.execPath, script = fileURLToPath(new URL('./claude-hook.mjs', import.meta.url)) } = {}) {
  if (!project) throw new Error('Informe a pasta do projeto com --project CAMINHO.');
  if (!(await stat(resolve(project))).isDirectory()) throw new Error('A pasta do projeto precisa existir.');
  const path = resolve(project, '.claude', 'settings.local.json');
  let settings = {}, previous = null;
  try { previous = await readFile(path, 'utf8'); settings = JSON.parse(previous); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || settings.hooks && (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))) throw new Error('settings.local.json inválido; arquivo preservado.');
  const generated = claudeHookConfig(node, script);
  const next = structuredClone(settings);
  next.hooks ||= {};
  for (const [event, entries] of Object.entries(generated.hooks)) {
    const existing = next.hooks[event] || [];
    if (!Array.isArray(existing) || existing.some(entry => !entry || !Array.isArray(entry.hooks))) throw new Error(`Hooks ${event} inválidos; arquivo preservado.`);
    // Replace only this bridge's exact script command. Other hooks survive,
    // including other tools' commands and hooks sharing a matcher group.
    const marker = `"${script.replaceAll('\\', '/')}"`;
    const kept = existing.map(entry => ({ ...entry, hooks: entry.hooks.filter(hook => !(hook.type === 'command' && typeof hook.command === 'string' && hook.command.includes(marker))) })).filter(entry => entry.hooks.length);
    next.hooks[event] = [...kept, ...entries];
  }
  const output = JSON.stringify(next, null, 2) + '\n';
  if (previous && JSON.stringify(settings) === JSON.stringify(next)) return { path, changed: false, backup: null };
  await mkdir(dirname(path), { recursive: true });
  const backup = previous === null ? null : `${path}.nexus-backup-${Date.now()}`;
  if (backup) await copyFile(path, backup);
  await writeFile(path, output, 'utf8');
  return { path, changed: true, backup };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const at = process.argv.indexOf('--project');
    if (at < 0 || !process.argv[at + 1]) throw new Error('Uso: node install-claude-project.mjs --project CAMINHO');
    console.log(JSON.stringify(await installClaudeProject(process.argv[at + 1])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
