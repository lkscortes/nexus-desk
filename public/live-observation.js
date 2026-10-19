export function sessionAgents(agents, sessionId) {
  return Object.values(agents || {}).filter(a => !sessionId || a.sessionId === sessionId);
}
const activeStatuses = new Set(['thinking', 'reading', 'writing', 'running', 'waiting', 'error']);
const recentFirst = (a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
const sessionScoped = character => character.sessionOnly === true || String(character.id || '').startsWith('session-avatar-');
export const completionGraceMs = 15000;
const roleKey = value => {
  const v = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/coord|principal|orchestrat|leader/.test(v)) return 'main';
  if (/valid|review|revis|test|qa/.test(v)) return 'review';
  if (/constr|build|implement|develop|cod(er|ing)/.test(v)) return 'build';
  if (/explor|scout|research|pesquis/.test(v)) return 'explore';
  return v;
};
export function viewedSessions(runtime, selected = '', now = Date.now()) {
  const sessions = Object.values(runtime.observation?.sessions || {});
  if (selected) return sessions.filter(s => s.id === selected);
  return sessions.filter(s => {
    if (s.status === 'offline') return false;
    const agents = sessionAgents(runtime.agents, s.id).filter(a => a.status !== 'offline');
    const age = now - Date.parse(s.updatedAt);
    return agents.some(a => activeStatuses.has(a.status)) && age < 30 * 60000 ||
      agents.length > 0 && age >= 0 && age < completionGraceMs;
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
export function displayedSessionAgents(runtime, sessionId, historical = false, now = Date.now()) {
  return sessionAgents(runtime.agents, sessionId).filter(a => historical || a.status !== 'offline' &&
    (!a.parentId || activeStatuses.has(a.status) || now - Date.parse(a.timestamp) < completionGraceMs));
}
export function liveTeam(characters, observed, session, now = Date.now()) {
  const bindings = new Map(), used = new Set();
  const principal = c => roleKey(c.role) === 'main' || /:main$/.test(c.binding || '');
  const ordered = [...observed].sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId) || a.agentId.localeCompare(b.agentId));
  // Per-conversation overrides own their exact runtime binding and never
  // become candidates for another conversation's role-based fallback.
  for (const c of characters.filter(sessionScoped)) {
    const a = observed.find(a => a.agentId === c.binding);
    if (a && !used.has(a.agentId)) { bindings.set(c.id, a); used.add(a.agentId); }
  }
  // Legacy exact links remain available, then their visual identity can be
  // reused for matching roles in other conversations.
  for (const c of characters) {
    if (sessionScoped(c)) continue;
    const a = observed.find(a => a.agentId === c.binding);
    if (a && !used.has(a.agentId)) { bindings.set(c.id, a); used.add(a.agentId); }
  }
  for (const a of ordered) {
    if (used.has(a.agentId)) continue;
    const candidates = characters.filter(c => !sessionScoped(c) && c.provider === a.provider && !bindings.has(c.id) && (!!a.parentId ? !principal(c) : principal(c)));
    const key = roleKey(a.role);
    const c = candidates.find(c => roleKey(c.role) === key) ||
      (!a.parentId || !['build', 'review', 'explore'].includes(key) ? candidates[0] : undefined);
    if (c) { bindings.set(c.id, a); used.add(a.agentId); }
  }
  return ordered.map(a => {
    const c = characters.find(c => bindings.get(c.id)?.agentId === a.agentId);
    return { ...(c || {}), ...a, name: c?.name || a.name, role: a.parentId ? c?.role || a.role : 'Coordenação',
      color: c?.color || a.color, hue: c?.hue ?? a.hue, sprite: c?.sprite ?? a.sprite, scale: c?.scale ?? a.scale,
      id: c ? `${session.id}:${c.id}` : a.agentId, templateId: c?.id, runtimeId: a.agentId,
      configured: !!c, conversationLabel: `${session.title || 'Conversa'} · ${session.id.slice(-8)}` };
  }).filter(a => a.configured || activeStatuses.has(a.status) ||
    a.status === 'done' && now - Date.parse(a.timestamp) < completionGraceMs);
}
export function extraObservedAgents(observed, bindings) {
  const bound = new Set([...bindings.values()].map(a => a.agentId));
  // Completed agents remain visible for their delivery animation; restored offline
  // records belong to history and must not become additional characters.
  return observed.filter(a => a.status !== 'offline' && !bound.has(a.agentId)).sort(recentFirst);
}
export function characterBindings(characters, observed) {
  const result = new Map(), used = new Set();
  for (const c of characters) {
    if (sessionScoped(c)) continue;
    const actual = observed.find(a => a.agentId === c.binding);
    if (actual && !used.has(actual.agentId)) { result.set(c.id, actual); used.add(actual.agentId); }
  }
  const automatic = observed.filter(a => a.status !== 'offline').sort((a, b) =>
    Number(!!a.parentId) - Number(!!b.parentId) ||
    Number(activeStatuses.has(b.status)) - Number(activeStatuses.has(a.status)) || recentFirst(a, b));
  for (const a of automatic) {
    if (used.has(a.agentId)) continue;
    const candidates = characters.filter(c => !sessionScoped(c) && c.provider === a.provider && !c.binding && !result.has(c.id));
    const words = String(a.role || '').toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const match = candidates.find(c => words.some(w => `${c.role} ${c.name}`.toLowerCase().includes(w))) || candidates[0];
    if (match) { result.set(match.id, a); used.add(a.agentId); }
  }
  return result;
}
