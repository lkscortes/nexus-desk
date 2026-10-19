import { createHash, randomUUID } from 'node:crypto';

const text = (v, n = 180) => typeof v === 'string' ? v.trim().slice(0, n) : '';
export const hookEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd'];
export const planningContext = 'Nexus acompanha esta conversa. Para trabalho com várias etapas, use update_plan com passos e estados pending/in_progress/completed; mantenha o plano atualizado após entregas e validações. Não marque completed apenas porque um subagente terminou. Delegue somente quando solicitado ou permitido pelas instruções do projeto. O painel é observacional e não altera permissões.';
const cardId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(value) ? value : '';

// Only allowlisted metadata leaves the hook. Never copy transcripts, commands,
// tool results, credentials or assistant messages into the dashboard.
export function cleanHook(raw) {
  if (!raw || !hookEvents.includes(raw.hook_event_name) || !text(raw.session_id, 120) || [raw.session_id, raw.agent_id].some(id => ['__proto__', 'constructor', 'prototype'].includes(id))) return null;
  const e = { eventId: text(raw.eventId, 160) || randomUUID(), session_id: text(raw.session_id, 120), hook_event_name: raw.hook_event_name,
    turn_id: text(raw.turn_id, 120), agent_id: text(raw.agent_id, 120), agent_type: text(raw.agent_type, 60), tool_name: text(raw.tool_name, 100),
    tool_use_id: text(raw.tool_use_id, 120), source: text(raw.source, 40), timestamp: new Date().toISOString() };
  if (e.hook_event_name === 'UserPromptSubmit') e.title = text(raw.title, 80) || 'Nova solicitação no chat';
  let input = raw.tool_input;
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = {}; } }
  const plan = input?.plan || raw.plan;
  if (e.hook_event_name === 'PostToolUse' && /(?:^|[.:/])update_plan$/.test(e.tool_name) && Array.isArray(plan)) {
    e.plan = plan.slice(0, 100).filter(p => p && text(p.step, 180) && ['pending', 'in_progress', 'completed'].includes(p.status)).map(p => ({ step: text(p.step, 180), status: p.status, ...(cardId(p.id) ? { id: p.id } : {}) }));
    if (plan.some(p => p?.id !== undefined && !cardId(p.id))) return null;
    const ids = e.plan.filter(p => p.id).map(p => p.id);
    if (new Set(ids).size !== ids.length) return null;
    const superseded = input?.superseded_steps || raw.superseded_steps;
    if (Array.isArray(superseded)) e.superseded_steps = [...new Set(superseded.slice(0, 100).map(step => text(step, 180)).filter(Boolean))];
    const removed = input?.superseded_ids || raw.superseded_ids;
    if (removed !== undefined && (!Array.isArray(removed) || removed.some(v => !cardId(v)))) return null;
    if (removed) e.superseded_ids = [...new Set(removed.slice(0, 100))];
  }
  return e;
}

export function createObservation() { return { sessions: {}, seen: [], latestSession: null }; }
export function restoreObservation(saved) {
  if (!saved || !saved.sessions || typeof saved.sessions !== 'object' || !Array.isArray(saved.seen) || Object.keys(saved.sessions).length > 50) throw new Error('Histórico inválido');
  for (const [id, s] of Object.entries(saved.sessions)) {
    if (['__proto__', 'constructor', 'prototype'].includes(id) || s.id !== id || !Array.isArray(s.tasks) || s.tasks.length > 100 || !s.children || typeof s.children !== 'object' || typeof s.updatedAt !== 'string') throw new Error('Sessão inválida');
    for (const t of s.tasks) if (typeof t.title !== 'string' || !['queued', 'active', 'done'].includes(t.status) || typeof t.id !== 'string' || typeof t.agentId !== 'string') throw new Error('Tarefa inválida');
    if (s.archivedTasks !== undefined && (!Array.isArray(s.archivedTasks) || s.archivedTasks.length > 100 || s.archivedTasks.some(t => typeof t.id !== 'string' || typeof t.title !== 'string'))) throw new Error('Arquivo de cartões inválido');
    // A restarted bridge has no evidence that a previously busy child finished.
    for (const c of Object.values(s.children)) if (!['done', 'offline'].includes(c.status)) c.status = 'waiting';
    if (['thinking', 'reading', 'writing', 'running'].includes(s.status)) s.status = 'waiting';
  }
  return { sessions: saved.sessions, seen: saved.seen.filter(v => typeof v === 'string').slice(-2000), latestSession: saved.latestSession };
}
export function restoreObservedAgents(saved, observation) {
  return Object.fromEntries(Object.entries(saved || {}).map(([key, a]) => {
    const session = observation.sessions[a.sessionId];
    const child = session && Object.values(session.children).find(c => key === `${session.provider || 'codex'}:${session.externalSessionId || session.id}:${c.id}`);
    const known = a.status === 'offline' && session?.status !== 'offline' ? child?.status || (!a.parentId ? session?.status : a.status) : a.status;
    const status = ['thinking', 'reading', 'writing', 'running', 'waiting'].includes(known) ? 'waiting' : known || 'idle';
    return [key, { ...a, status, lastKnownStatus: known, connection: status === 'offline' ? 'closed' : 'awaiting-event',
      message: status === 'waiting' ? 'Painel reconectado · aguardando novo evento da conversa' : a.message }];
  }));
}
export function applyHook(state, e, { provider = 'codex', externalSessionId = e?.session_id } = {}) {
  if (!e || !(hookEvents.includes(e.hook_event_name) || provider === 'claude' && e.hook_event_name === 'PostToolUseFailure') || !e.session_id || state.seen.includes(e.eventId)) return null;
  const childOwner = Object.values(state.sessions).find(s => (s.provider || 'codex') === provider && s.children[e.session_id]);
  const id = childOwner?.id || e.session_id;
  let s = state.sessions[id];
  if (!s) {
    s = state.sessions[id] = { id, ...(provider === 'claude' ? { provider, externalSessionId } : {}), title: provider === 'claude' ? 'Conversa Claude Code' : 'Conversa Codex', tasks: [], children: {}, updatedAt: e.timestamp, status: 'idle', totalEvents: 0 };
    const ids = Object.keys(state.sessions); if (ids.length > 50) delete state.sessions[ids[0]];
  }
  state.seen.push(e.eventId); state.seen = state.seen.slice(-2000);
  state.latestSession = id; s.updatedAt = e.timestamp;
  s.totalEvents = (s.totalEvents || 0) + 1;
  const childId = e.agent_id || (childOwner ? e.session_id : '');
  const rootAgent = `${provider}:${s.externalSessionId || id}:main`, agentId = childId ? `${provider}:${s.externalSessionId || id}:${childId}` : rootAgent;
  const kind = e.hook_event_name;
  const busy = () => Object.values(s.children).some(c => !['done', 'offline'].includes(c.status));
  let status = 'thinking', message = kind;
  if (kind === 'SessionStart') { status = 'idle'; message = 'Conversa conectada'; }
  if (kind === 'UserPromptSubmit') {
    status = 'thinking'; message = 'Nova instrução recebida'; s.title = e.title || s.title;
    const requestId = `request:${e.turn_id || e.eventId}`;
    if (!s.tasks.some(t => t.id === requestId)) s.tasks.push({ id: requestId, title: e.title, description: 'Aguardando o plano do agente principal', status: 'queued', agentId: rootAgent, request: true });
  }
  if (kind === 'PreToolUse') { status = /patch|edit|write/i.test(e.tool_name) ? 'writing' : /bash|exec|command/i.test(e.tool_name) ? 'running' : /read|search|grep/i.test(e.tool_name) ? 'reading' : 'thinking'; message = `Usando ${e.tool_name}`; }
  if (kind === 'PostToolUse') message = `Etapa de ferramenta encerrada · ${e.tool_name}`;
  if (kind === 'PostToolUseFailure') { status = 'error'; message = `Ferramenta falhou · ${e.tool_name}`; }
  if (kind === 'PermissionRequest') { status = 'waiting'; message = `Aguardando aprovação no ${provider === 'claude' ? 'Claude Code' : 'Codex'}`; }
  if (kind === 'SubagentStart') {
    if (!childId) return null;
    s.children[childId] = { id: childId, role: e.agent_type || 'Subagente', status: 'thinking' };
    s.tasks.push({ id: `delegate:${childId}`, title: `Delegação · ${e.agent_type || 'Subagente'}`, description: 'Subagente real em execução; escopo detalhado permanece no chat', status: 'active', agentId, delegation: true });
    message = 'Delegação iniciada';
  }
  if (kind === 'SubagentStop') { if (s.children[childId]) s.children[childId].status = 'done'; const task = s.tasks.find(t => t.id === `delegate:${childId}`); if (task) { task.description = 'Etapa devolvida; aguardando validação do principal'; task.status = 'active'; } status = 'done'; message = 'Subagente devolveu sua etapa · principal deve validar'; }
  if (kind === 'Stop') {
    const delivered = childId && s.children[childId]?.status === 'done';
    status = delivered ? 'done' : 'idle';
    message = delivered ? 'Subagente encerrou o turno após entregar · principal deve validar' : 'Turno encerrado · confira o plano';
  }
  if (kind === 'Interrupt') { status = 'waiting'; message = 'Turno interrompido'; }
  if (kind === 'SessionEnd') { status = 'offline'; message = 'Conversa encerrada'; }
  if (childId && s.children[childId] && !['SubagentStart', 'SubagentStop'].includes(kind)) s.children[childId].status = status;
  if (!childId) s.status = status;
  if (Array.isArray(e.plan) && !childId && (e.plan.length || e.superseded_ids?.length || e.superseded_steps?.length)) {
    const delegations = s.tasks.filter(t => t.delegation);
    const previousTasks = s.tasks.filter(t => !t.delegation && !t.request);
    const occurrences = new Map();
    s.tasks = e.plan.map(p => {
      const occurrence = occurrences.get(p.step) || 0; occurrences.set(p.step, occurrence + 1);
      const legacyId = createHash('sha256').update(`${id}:${p.step}:${occurrence}`).digest('hex').slice(0, 32);
      const previous = p.id ? previousTasks.find(t => t.id === p.id || t.externalId === p.id) || previousTasks.find(t => t.id === legacyId && !t.externalId) : previousTasks.find(t => t.id === legacyId) || previousTasks.filter(t => t.title === p.step)[occurrence];
      const taskId = previous?.id || (p.id ? createHash('sha256').update(`${id}:card:${p.id}`).digest('hex').slice(0, 32) : legacyId);
      const pendingValidation = p.status === 'completed' && busy();
      return { id: taskId, ...((p.id || previous?.externalId) ? { externalId: p.id || previous.externalId } : {}), title: p.step, description: pendingValidation ? 'Entrega indicada; aguardando subagentes e nova validação do principal' : p.status === 'completed' ? 'Concluída explicitamente no plano do principal' : 'Plano do agente principal', status: p.status === 'pending' ? 'queued' : p.status === 'completed' && !pendingValidation ? 'done' : 'active', agentId: rootAgent };
    });
    const updatedIds = new Set(s.tasks.map(t => t.id));
    if (updatedIds.size !== s.tasks.length) throw new Error('Duas etapas apontam para o mesmo cartão. Publique cada ID uma única vez.');
    // Omission preserves history. Only an explicit replacement removes old plan cards.
    const superseded = new Set(e.superseded_steps || []);
    const supersededIds = new Set(e.superseded_ids || []);
    const replaced = previousTasks.filter(t => !updatedIds.has(t.id) && (superseded.has(t.title) || supersededIds.has(t.id) || supersededIds.has(t.externalId)));
    s.archivedTasks = [...(s.archivedTasks || []), ...replaced.map(t => ({ ...t, archivedAt: e.timestamp, archiveReason: 'Substituído explicitamente pelo principal', replacedBy: [...updatedIds] }))].slice(-100);
    const removedIds = new Set(replaced.map(t => t.id));
    s.tasks.unshift(...previousTasks.filter(t => !updatedIds.has(t.id) && !removedIds.has(t.id)));
    // Validation belongs to the submitted work batch, not the entire historical
    // backlog. Pending roadmap cards must not keep delivered auxiliaries active.
    const validated = e.plan.length > 0 && e.plan.every(p => p.status === 'completed') && !busy();
    s.tasks.push(...delegations.map(t => validated && s.children[t.id.slice(9)]?.status === 'done' ? { ...t, status: 'done', description: 'Entrega validada pela conclusão explícita do plano principal' } : t));
    status = validated ? 'done' : e.plan.some(p => p.status !== 'pending') ? 'thinking' : 'idle';
    message = validated ? 'Plano concluído e validado pelo principal' : 'Quadro atualizado pelo plano principal';
    s.status = status;
  }
  s.tasks = s.tasks.slice(-100);
  return { provider, agentId, sessionId: id, parentId: childId ? rootAgent : null, name: childId ? e.agent_type || s.children[childId]?.role || 'Subagente' : `${provider === 'claude' ? 'Claude Code' : 'Codex'} · principal`, role: childId ? e.agent_type || 'Subagente' : 'Coordenação', status, message, eventId: e.eventId };
}

export function hookConfig(node, script) {
  const command = `"${node.replaceAll('\\', '/')}" "${script.replaceAll('\\', '/')}"`;
  return { hooks: Object.fromEntries(hookEvents.map(event => [event, [{ hooks: [{ type: 'command', command, timeout: 3, ...(event === 'SessionStart' || event === 'UserPromptSubmit' ? { additionalContextLimit: 1000 } : {}) }] }]])) };
}
