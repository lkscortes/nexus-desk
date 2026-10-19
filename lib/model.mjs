import { randomUUID } from 'node:crypto';

export const STATUSES = ['idle', 'thinking', 'reading', 'writing', 'running', 'waiting', 'done', 'error', 'offline'];
export const PROVIDERS = ['claude', 'codex', 'custom'];
export const colors = ['#55c8ff', '#ff70cc', '#6df5b0', '#be8bff', '#ffd269', '#ff8d74'];
export const defaultConfig = () => ({
  title: 'NEXUS', subtitle: 'Meu laboratório de ideias', accent: '#68e8f9', glow: 65, motion: true, grid: true, compact: false, layout: 'orbit',
  agents: [
    { id: 'atlas', name: 'Atlas', role: 'Construção', provider: 'codex', color: colors[0], hue: 0, x: 25, y: 37, scale: 100, sprite: '', binding: '' },
    { id: 'nova', name: 'Nova', role: 'Exploração', provider: 'claude', color: colors[1], hue: 100, x: 75, y: 37, scale: 100, sprite: '', binding: '' },
    { id: 'orbit', name: 'Orbit', role: 'Revisão', provider: 'claude', color: colors[2], hue: 260, x: 50, y: 78, scale: 100, sprite: '', binding: '' }
  ]
});
const clamp = (v, min, max, fallback) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : fallback;
const cleanText = (v, max, fallback = '') => typeof v === 'string' ? v.trim().slice(0, max) : fallback;
export function validateConfig(input) {
  if (!input || !Array.isArray(input.agents) || input.agents.length > 64) throw new Error('Use de 0 a 64 agentes.');
  const ids = new Set();
  const config = defaultConfig();
  for (const key of ['title', 'subtitle']) config[key] = cleanText(input[key], key === 'title' ? 32 : 80, config[key]);
  config.accent = /^#[a-fA-F0-9]{6}$/.test(input.accent || '') ? input.accent : config.accent;
  config.glow = clamp(input.glow, 0, 100, 65);
  for (const key of ['motion', 'grid', 'compact']) config[key] = typeof input[key] === 'boolean' ? input[key] : config[key];
  config.layout = ['orbit', 'grid'].includes(input.layout) ? input.layout : 'orbit';
  let spriteBudget = 0;
  config.agents = input.agents.map((a, i) => {
    const id = cleanText(a.id, 64) || randomUUID();
    if (ids.has(id)) throw new Error('Cada agente precisa de um identificador único.');
    ids.add(id);
    const sprite = cleanText(a.sprite, 1400000);
    if (sprite && !/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(sprite)) throw new Error('A imagem precisa ser PNG, WebP ou JPEG.');
    spriteBudget += sprite.length;
    if (spriteBudget > 6_000_000) throw new Error('As imagens dos personagens precisam ocupar menos de 6 MB no total.');
    return { id, name: cleanText(a.name, 32, 'Agente'), role: cleanText(a.role, 48, 'Assistente'), provider: PROVIDERS.includes(a.provider) ? a.provider : 'custom',
      color: /^#[a-fA-F0-9]{6}$/.test(a.color || '') ? a.color : colors[i % colors.length], hue: clamp(a.hue, 0, 360, 0),
      x: clamp(a.x, 12, 88, 50), y: clamp(a.y, 25, 84, 50), scale: clamp(a.scale, 65, 125, 100), sprite, binding: cleanText(a.binding, 200), sessionOnly: (a.sessionOnly === true || id.startsWith('session-avatar-')) && !!a.binding };
  });
  return config;
}

export function validateEvent(input) {
  if (!input || !PROVIDERS.includes(input.provider) || !STATUSES.includes(input.status)) throw new Error('Provedor ou estado inválido.');
  if (typeof input.agentId !== 'string' || !input.agentId.trim() || input.agentId.length > 200) throw new Error('agentId inválido.');
  const result = { provider: input.provider, agentId: input.agentId, status: input.status, name: cleanText(input.name, 50, input.provider), role: cleanText(input.role, 60, 'Sessão'), message: cleanText(input.message, 180, 'Atividade recebida'), sessionId: cleanText(input.sessionId, 120), parentId: cleanText(input.parentId, 200) || null, timestamp: new Date().toISOString() };
  if (typeof input.eventId === 'string') result.eventId = cleanText(input.eventId, 160);
  if (Number.isFinite(input.tokens) && input.tokens >= 0) result.tokens = Math.round(input.tokens);
  return result;
}

export function createRuntime() { return { agents: {}, events: [], totalEvents: 0, providers: { claude: null, codex: null, custom: null } }; }
export function applyEvent(runtime, raw) {
  const event = validateEvent(raw);
  if (event.eventId && runtime.events.some(e => e.eventId === event.eventId && e.provider === event.provider)) return null;
  const previous = runtime.agents[event.agentId] || {};
  runtime.agents[event.agentId] = { ...previous, ...event, connection: event.status === 'offline' ? 'closed' : 'receiving', count: (previous.count || 0) + 1 };
  runtime.events.unshift({ ...event, id: randomUUID() });
  runtime.events = runtime.events.slice(0, 100);
  runtime.totalEvents++;
  runtime.providers[event.provider] = event.timestamp;
  // Bound memory when an unattended bridge sees many sessions.
  const entries = Object.entries(runtime.agents);
  if (entries.length > 120) {
    entries.sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp));
    delete runtime.agents[entries[0][0]];
  }
  return event;
}
