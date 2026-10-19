import { cleanHook, applyHook } from './codex-hooks.mjs';

// Claude's documented command-hook events only. No transcript or tool result is
// read, and Stop is a lifecycle signal rather than evidence of task completion.
export const claudeHookEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd'];
export function cleanClaudeHook(raw) {
  if (!raw || !(claudeHookEvents.includes(raw.hook_event_name) || raw.nexus_mcp === true && raw.hook_event_name === 'Interrupt')) return null;
  const failure = raw.hook_event_name === 'PostToolUseFailure';
  const mcp = raw.nexus_mcp === true;
  const event = cleanHook({ ...raw, hook_event_name: failure ? 'PostToolUse' : raw.hook_event_name,
    eventId: raw.eventId || raw.event_id, prompt: undefined, title: mcp ? raw.title : 'Conversa Claude Code', tool_input: mcp ? raw.tool_input : undefined, plan: mcp ? raw.plan : undefined,
    superseded_ids: mcp ? raw.superseded_ids : undefined, superseded_steps: mcp ? raw.superseded_steps : undefined });
  if (!event) return null;
  event.provider = 'claude';
  if (mcp) event.nexus_mcp = true;
  event.hook_event_name = raw.hook_event_name;
  if (event.hook_event_name === 'PostToolUse' && event.tool_name === 'TodoWrite') {
    let input = raw.tool_input;
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = null; } }
    const todos = input?.todos || raw.todos;
    if (Array.isArray(todos)) {
      event.todos = todos.slice(0, 100).filter(t => t && typeof t.content === 'string' && t.content.trim() && ['pending', 'in_progress', 'completed'].includes(t.status))
        .map(t => ({ content: t.content.trim().slice(0, 180), status: t.status }));
    }
  }
  return event;
}
export function applyClaudeHook(state, event) {
  return applyHook(state, { ...event, session_id: `claude:${event.session_id}`,
    ...(event.todos ? { plan: event.todos.map(t => ({ step: t.content, status: t.status })) } : {}) },
  { provider: 'claude', externalSessionId: event.session_id });
}
export function claudeHookConfig(node, script) {
  const command = `"${node.replaceAll('\\', '/')}" "${script.replaceAll('\\', '/')}"`;
  return { hooks: Object.fromEntries(claudeHookEvents.map(name => [name, [{
    ...(name.includes('ToolUse') || name.startsWith('Subagent') || name === 'PermissionRequest' ? { matcher: '*' } : {}),
    hooks: [{ type: 'command', command, timeout: 3 }]
  }]])) };
}

export function claudePlanningContext(sessionId) {
  return `Nexus acompanha esta conversa do Claude. O ID real informado pelo hook é ${JSON.stringify(sessionId)}. Use esse ID em session_id e provider="claude" nas ferramentas MCP Nexus disponíveis, nunca um ID inventado. Registre a conversa com um título curto e publique o plano em etapas com IDs estáveis e estados pending/in_progress/completed; atualize ao trabalhar e após validar entregas. read_board evita cartões duplicados. Registre SubagentStart/Stop somente para auxiliares realmente criados e entregues; não delegue apenas para preencher o painel. Ao terminar, agent_event Stop. Não marque tarefa concluída apenas porque uma ferramenta terminou. Eventos queued não confirmam publicação. Não envie prompts, respostas, comandos nem segredos. Se o MCP não estiver disponível, os hooks ainda acompanham atividade e TodoWrite; informe a limitação sem inventar registros. Este acompanhamento é observacional e não muda permissões.`;
}
