import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanHook } from '../lib/codex-hooks.mjs';
import { resolveBridgeFile, resolveDataDir } from '../lib/paths.mjs';
const fileArg = process.argv.indexOf('--file'), sessionArg = process.argv.indexOf('--session');
const session = sessionArg >= 0 ? process.argv[sessionArg + 1] : process.env.CODEX_THREAD_ID;
if (!session || fileArg < 0) { console.error('Uso: node report-plan.mjs --session ID --file plano.json (objeto com plan: [{step,status}])'); process.exit(1); }
const document = JSON.parse(await readFile(process.argv[fileArg + 1], 'utf8'));
const { plan, superseded_steps, superseded_ids } = document;
if (!Array.isArray(plan)) throw new Error('O arquivo precisa conter plan.');
const payload = { session_id: session, hook_event_name: 'PostToolUse', tool_name: 'update_plan', tool_input: { plan, superseded_steps, superseded_ids } };
const cleaned = cleanHook(payload);
if (!cleaned || cleaned.plan.length !== plan.length) throw new Error('Plano inválido: use até 100 etapas válidas e IDs únicos (letras, números, ponto, hífen, dois-pontos ou sublinhado).');
if (plan.some(p => p.id) || superseded_ids?.length) {
  const bridge = JSON.parse(await readFile(resolveBridgeFile(), 'utf8'));
  const health = await fetch(bridge.origin + '/api/health', { signal: AbortSignal.timeout(2000) }).then(r => r.json());
  if (health.cardProtocolVersion !== 1) throw new Error('Reinicie o Nexus: o servidor ativo ainda não suporta IDs estáveis de cartões.');
}
const child = spawn(process.execPath, [fileURLToPath(new URL('./codex-hook.mjs', import.meta.url))], { stdio: ['pipe', 'ignore', 'inherit'], windowsHide: true, env: { ...process.env, NEXUS_DATA_DIR: resolveDataDir(), NEXUS_REPORT_PLAN: '1' } });
child.stdin.end(JSON.stringify(payload));
child.on('error', e => { console.error(e.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
