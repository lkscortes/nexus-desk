// These adapters observe lifecycle events. They never approve or execute tools.
const short = (value, max = 180) => String(value || '').slice(0, max);
const friendlyTool = (tool = '') => {
  if (/read|grep|glob|search|explore/i.test(tool)) return 'reading';
  if (/edit|write|patch|filechange/i.test(tool)) return 'writing';
  if (/bash|shell|command|exec/i.test(tool)) return 'running';
  return 'thinking';
};

export function fromClaude(payload) {
  if (!payload || typeof payload !== 'object' || !payload.session_id) return null;
  const event = payload.hook_event_name;
  const states = { SessionStart: 'idle', UserPromptSubmit: 'thinking', PreToolUse: friendlyTool(payload.tool_name), PostToolUse: 'thinking', PostToolUseFailure: 'error', PermissionRequest: 'waiting', SubagentStart: 'thinking', SubagentStop: 'done', Stop: 'done', SessionEnd: 'offline' };
  if (!(event in states)) return null;
  const isChild = !!payload.agent_id;
  const input = payload.tool_input || {};
  // Do not forward prompts, tool output, environment variables or full transcripts.
  const subject = input.file_path ? String(input.file_path).split(/[\\/]/).pop() : payload.tool_name;
  return {
    provider: 'claude', agentId: `claude:${payload.session_id}:${payload.agent_id || 'main'}`,
    sessionId: short(payload.session_id, 120), parentId: isChild ? `claude:${payload.session_id}:main` : null,
    name: short(payload.agent_type || (isChild ? 'Subagente Claude' : 'Claude Code'), 50),
    role: short(payload.agent_type || 'Sessão', 60), status: states[event],
    message: subject ? `${event} · ${short(subject, 100)}` : event,
    eventId: typeof payload.event_id === 'string' ? short(payload.event_id, 160) : undefined
  };
}

export function fromCodex(payload, context = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const type = payload.type || payload.method;
  const params = payload.params || payload;
  const threadId = payload.thread_id || params.threadId || params.thread?.id || context.threadId;
  if (!threadId) return null;
  const item = params.item || {};
  const normalize = value => String(value || '').replace(/[_/]/g, '').toLowerCase();
  let status, message;
  if (['thread.started', 'thread/started'].includes(type)) { status = 'idle'; message = 'Sessão iniciada'; }
  else if (['turn.started', 'turn/started'].includes(type)) { status = 'thinking'; message = 'Preparando a tarefa'; }
  else if (['turn.completed', 'turn/completed'].includes(type)) {
    const turnStatus = params.turn?.status;
    status = turnStatus === 'failed' ? 'error' : turnStatus === 'interrupted' ? 'idle' : 'done';
    message = status === 'done' ? 'Turno concluído' : status === 'error' ? 'Turno falhou' : 'Turno interrompido';
  }
  else if (['turn.failed', 'error'].includes(type)) { status = 'error'; message = 'A sessão encontrou um erro'; }
  else if (String(type).endsWith('/requestApproval')) { status = 'waiting'; message = 'Aguardando aprovação no Codex'; }
  else if (['item.started', 'item/started', 'item.updated'].includes(type)) {
    const kind = normalize(item.type);
    status = kind.includes('command') ? 'running' : kind.includes('filechange') ? 'writing' : kind.includes('search') ? 'reading' : 'thinking';
    message = status === 'running' ? 'Executando comando' : status === 'writing' ? 'Alterando arquivos' : status === 'reading' ? 'Pesquisando' : 'Trabalhando na tarefa';
  }
  else if (['item.completed', 'item/completed'].includes(type)) {
    status = item.status === 'failed' ? 'error' : 'thinking'; message = status === 'error' ? 'Ferramenta falhou' : 'Etapa concluída';
  } else return null;
  const usage = params.usage;
  return { provider: 'codex', agentId: `codex:${threadId}`, sessionId: short(threadId, 120), name: short(context.name || 'Codex', 50), role: 'Sessão', status, message,
    eventId: typeof payload.event_id === 'string' ? short(payload.event_id, 160) : undefined,
    ...(usage ? { tokens: Math.max(0, Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0)) } : {}) };
}
