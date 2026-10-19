import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanHook } from './codex-hooks.mjs';
import { cleanClaudeHook } from './claude-observation.mjs';

const sessionProperty = { type: 'string', minLength: 1, maxLength: 120, description: 'ID real da conversa: CODEX_THREAD_ID no Codex ou session_id fornecido pelo hook Claude. Nunca invente IDs.' };
const schema = (properties, required) => ({ type: 'object', properties: { session_id: sessionProperty, provider: { enum: ['codex', 'claude'], description: 'Provedor da conversa. O padrão é configurado na instalação.' }, ...properties }, required: ['session_id', ...required], additionalProperties: false });
export const nexusTools = [
  { name: 'register_conversation', description: 'Registra a primeira instrução real desta conversa no Nexus. Chame no começo de cada turno; depois publique o plano. Não executa trabalho.', inputSchema: schema({ title: { type: 'string', minLength: 1, maxLength: 80 }, turn_id: { type: 'string', maxLength: 120 } }, ['title']) },
  { name: 'publish_plan', description: 'Publica cartões reais: pending=fila, in_progress=andamento, completed=entrega validada pelo principal. Preserve IDs ao renomear; omissões preservam histórico. Use superseded_ids para substituir explicitamente cartões.', inputSchema: schema({ plan: { type: 'array', maxItems: 100, items: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$' }, step: { type: 'string', minLength: 1, maxLength: 180 }, status: { enum: ['pending', 'in_progress', 'completed'] } }, required: ['id', 'step', 'status'], additionalProperties: false } }, superseded_ids: { type: 'array', maxItems: 100, items: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$' } } }, ['plan']) },
  { name: 'agent_event', description: 'Relata apenas um evento que realmente ocorreu. SubagentStart depois de criar um auxiliar real, SubagentStop depois da entrega real, Stop ao encerrar o turno. Nunca simule execução ou invente IDs.', inputSchema: schema({ event: { enum: ['SubagentStart', 'SubagentStop', 'Stop', 'Interrupt'] }, agent_id: { type: 'string', maxLength: 120 }, role: { type: 'string', maxLength: 60 } }, ['event']) },
  { name: 'read_board', description: 'Confere cartões e estados confirmados desta conversa no Nexus, sem retornar transcrições ou credenciais.', inputSchema: schema({}, []) }
];

export function createNexusTools({ dataDir, provider: defaultProvider = 'codex' }) {
  if (!['codex', 'claude'].includes(defaultProvider)) throw new Error('Provedor MCP inválido.');
  async function bridge() { return JSON.parse(await readFile(join(dataDir, 'bridge.json'), 'utf8')); }
  async function state() { const b = await bridge(); const r = await fetch(b.origin + '/api/state', { signal: AbortSignal.timeout(2000) }); if (!r.ok) throw new Error(`Nexus respondeu ${r.status}`); return r.json(); }
  async function publish(raw, provider) {
    const event = provider === 'claude' ? cleanClaudeHook({ ...raw, nexus_mcp: true }) : cleanHook(raw);
    if (!event || (raw.tool_input?.plan && event.plan?.length !== raw.tool_input.plan.length)) throw new Error('Evento ou plano inválido.');
    const dir = join(dataDir, 'inbox'); await mkdir(dir, { recursive: true });
    const path = join(dir, event.eventId.replace(/[^a-zA-Z0-9-]/g, '') + '.json');
    const tmp = path + '.tmp'; await writeFile(tmp, JSON.stringify(event));
    const { rename } = await import('node:fs/promises'); await rename(tmp, path);
    try {
      const b = await bridge();
      const r = await fetch(b.origin + `/api/hooks/${provider}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.token}` }, body: JSON.stringify(event), signal: AbortSignal.timeout(2000) });
      if (!r.ok || (await r.json()).received !== true) throw new Error('Sem confirmação do servidor.');
      await unlink(path).catch(e => { if (e.code !== 'ENOENT') throw e; });
      return { confirmed: true, session_id: event.session_id };
    } catch { return { confirmed: false, queued: true, session_id: event.session_id, message: 'Evento salvo localmente para reenvio automático. Ainda não confirme publicação no painel.' }; }
  }
  return async (name, args = {}) => {
    if (!nexusTools.some(t => t.name === name)) throw new Error('Ferramenta desconhecida.');
    const session = args.session_id;
    if (typeof session !== 'string' || !session.trim() || session.length > 120 || ['__proto__', 'constructor', 'prototype'].includes(session)) throw new Error('Informe o ID real da conversa em session_id.');
    const provider = args.provider || defaultProvider;
    if (!['codex', 'claude'].includes(provider)) throw new Error('Provedor deve ser codex ou claude.');
    const externalSession = provider === 'claude' ? session.replace(/^claude:/, '') : session;
    if (!externalSession || ['__proto__', 'constructor', 'prototype'].includes(externalSession)) throw new Error('ID real inválido.');
    const key = provider === 'claude' ? `claude:${externalSession}` : session;
    if (name === 'read_board') {
      const s = (await state()).runtime?.observation?.sessions?.[key];
      return s ? { session_id: s.id, title: s.title, status: s.status, tasks: s.tasks.map(t => ({ id: t.externalId || t.id, title: t.title, status: t.status, agentId: t.agentId })), children: s.children } : { session_id: session, registered: false };
    }
    if (name === 'register_conversation') {
      if (typeof args.title !== 'string' || !args.title.trim() || args.title.length > 80) throw new Error('Título deve ter entre 1 e 80 caracteres.');
      return publish({ session_id: externalSession, hook_event_name: 'UserPromptSubmit', title: args.title, turn_id: args.turn_id }, provider);
    }
    if (name === 'publish_plan') {
      if (!Array.isArray(args.plan) || args.plan.length > 100 || args.plan.some(p => !p?.id || typeof p.step !== 'string' || p.step.length > 180 || !['pending', 'in_progress', 'completed'].includes(p.status)) || (args.superseded_ids?.length > 100)) throw new Error('Plano inválido.');
      return publish({ session_id: externalSession, hook_event_name: 'PostToolUse', tool_name: 'update_plan', tool_input: args }, provider);
    }
    if (!['SubagentStart', 'SubagentStop', 'Stop', 'Interrupt'].includes(args.event) || (args.event.startsWith('Subagent') && !args.agent_id)) throw new Error('Evento de auxiliar exige agent_id real.');
    // Hooks may already have reported the same lifecycle transition. Avoid
    // emitting a second delegation when the native path is working.
    if (args.event.startsWith('Subagent')) {
      try {
        const child = (await state()).runtime?.observation?.sessions?.[key]?.children?.[args.agent_id];
        if (child && (args.event === 'SubagentStart' && !['done', 'offline'].includes(child.status) || args.event === 'SubagentStop' && child.status === 'done')) return { confirmed: true, session_id: session, already_reported: true };
      } catch { /* Queue the actual event if the board is unavailable. */ }
    }
    return publish({ session_id: externalSession, hook_event_name: args.event, agent_id: args.agent_id, agent_type: args.role }, provider);
  };
}
