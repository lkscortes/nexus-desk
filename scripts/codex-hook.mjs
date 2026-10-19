import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cleanHook, planningContext } from '../lib/codex-hooks.mjs';
import { sendEvent } from './bridge.mjs';
import { resolveDataDir } from '../lib/paths.mjs';
import { join } from 'node:path';
let input = '';
try {
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 2_000_000) process.exit(0); }
  const event = cleanHook(JSON.parse(input));
  if (event) {
    const dir = join(resolveDataDir(), 'inbox');
    await mkdir(dir, { recursive: true });
    const path = join(dir, event.eventId.replace(/[^a-zA-Z0-9-]/g, '') + '.json');
    await writeFile(path, JSON.stringify(event));
    try { const ack = await sendEvent(event, '/api/hooks/codex'); if (ack.received === true) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); else throw new Error('Publicação não confirmada pelo Nexus.'); } catch (error) {
      // Hooks remain non-blocking. Explicit publication must report failed delivery.
      if (process.env.NEXUS_REPORT_PLAN === '1') { console.error('Plano guardado na fila local, mas sem confirmação do Nexus: ' + error.message); process.exitCode = 1; }
    }
    if (['SessionStart', 'UserPromptSubmit'].includes(event.hook_event_name)) {
      const reporter = fileURLToPath(new URL('./report-plan.mjs', import.meta.url));
      const fallback = ` Se update_plan não estiver disponível, ou precisar renomear/dividir cartões, salve JSON {"plan":[{"id":"identificador-fixo","step":"título","status":"pending|in_progress|completed"}],"superseded_ids":[]} e execute ${JSON.stringify(process.execPath)} ${JSON.stringify(reporter)} --session ${JSON.stringify(event.session_id)} --file CAMINHO_DO_JSON. Preserve id ao renomear. Para dividir, liste o id antigo em superseded_ids e dê IDs novos às partes. IDs e superseded_ids são campos do publicador Nexus, não parâmetros adicionais do tool nativo update_plan. No PowerShell use & antes do executável. O script só atualiza o quadro; não executa tarefas. Confirme o envio antes de declarar publicação concluída.`;
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event.hook_event_name, additionalContext: planningContext + fallback } }));
    } else process.stdout.write('{}');
  }
} catch (error) {
  if (process.env.NEXUS_REPORT_PLAN === '1') { console.error('Falha ao publicar plano: ' + error.message); process.exitCode = 1; }
  // Normal hooks never interrupt Codex when the dashboard fails.
}
