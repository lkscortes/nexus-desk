/* Nexus Desk: dependency-free UI. Provider adapters live on the local server. */
'use strict';
import { formationPositions, migrateFormation, runtimeTransfers } from './workflow.js';
import { HandoffController } from './handoff.js';
import { PanelLayout } from './panel-layout.js';
import { characterHue, characterSkinId, loadCharacterSkins } from './character-skins.js';
import { viewedSessions, liveTeam, displayedSessionAgents } from './live-observation.js';
import { clampScenePosition, loadScenePositions, saveScenePosition, scenePositionKey } from './scene-positions.js';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const palette = [ { color: '#55c8ff', hue: 0, label: 'Azul' }, { color: '#ff70cc', hue: 100, label: 'Rosa' }, { color: '#6df5b0', hue: 260, label: 'Verde' }, { color: '#be8bff', hue: 55, label: 'Violeta' }, { color: '#ffd269', hue: 200, label: 'Dourado' }, { color: '#ff8d74', hue: 150, label: 'Coral' } ];
const statusNames = { idle: 'Em descanso', thinking: 'Pensando', reading: 'Explorando', writing: 'Construindo', running: 'Executando', waiting: 'Precisa de você', done: 'Concluído', error: 'Encontrou um erro', offline: 'Sem conexão' };
const providerNames = { claude: 'Claude Code', codex: 'Codex', custom: 'Personalizado' };
const activeStatuses = ['thinking', 'reading', 'writing', 'running'];
const spriteUrl = agent => agent.sprite || 'assets/mascot-blue.webp';
const storageKey = 'nexus-desk:v1';
const scenePositionsKey = 'nexus-desk:scene-positions:v1';
let scenePositions = loadScenePositions(localStorage, scenePositionsKey);
const freshConfig = () => ({ title: 'NEXUS', subtitle: 'Meu laboratório de ideias', accent: '#68e8f9', glow: 65, motion: true, grid: true, compact: false, layout: 'orbit', agents: [
  { id: 'atlas', name: 'Atlas', role: 'Construção', provider: 'codex', color: '#55c8ff', hue: 0, x: 25, y: 37, scale: 100, sprite: '', binding: '' },
  { id: 'nova', name: 'Nova', role: 'Exploração', provider: 'claude', color: '#ff70cc', hue: 100, x: 75, y: 37, scale: 100, sprite: '', binding: '' },
  { id: 'orbit', name: 'Orbit', role: 'Revisão', provider: 'claude', color: '#6df5b0', hue: 260, x: 50, y: 78, scale: 100, sprite: '', binding: '' }
] });
const emptyRuntime = () => ({ agents: {}, events: [], totalEvents: 0, providers: { claude: null, codex: null, custom: null } });
const freshTasks = () => [
  { id: 'task-1', title: 'Dar vida à próxima ideia', description: 'Organizar o que vamos construir.', status: 'queued', agentId: 'nova' },
  { id: 'task-2', title: 'Construir uma interface', description: 'Um espaço para acompanhar sua equipe.', status: 'active', agentId: 'atlas' },
  { id: 'task-3', title: 'Preparar o universo', description: 'Escolher os primeiros companheiros.', status: 'done', agentId: 'orbit' }
];
let config = freshConfig(), tasks = freshTasks(), runtime = emptyRuntime(), mode = 'demo', demoRunning = true, demoAgents = {}, demoEvents = [], demoCount = 0, selected = null, bridgeReady = false, token = '', stream, activeTab = 'agents', integrations = null, toastTimer, demoStep = 0, saveQueue = Promise.resolve(), drag = null, suppressClick = false;
let editorDraft = null, pendingSaves = 0;
let observationSession = '';
function liveSessions() { return viewedSessions(runtime, observationSession); }
function boardTasks() { return mode === 'demo' ? tasks : liveSessions().flatMap(s => s.tasks.map(t => ({ ...t, conversationLabel: `${s.title} · ${s.id.slice(-8)}` }))); }
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const handoffs = new HandoffController({ scene: $('#scene'), hub: $('#handoff-hub'), layer: $('#courier-layer'), getAgents: visibleAgents, canMove: () => config.motion && !reducedMotion.matches, onPhase: (job, phase) => {
  if (job.mode !== mode || mode !== 'demo') return;
  const agent = config.agents.find(a => a.id === job.agentId); if (!agent) return;
  const messages = { outbound: job.kind === 'deliver' ? 'Levando a tarefa até a mesa central' : 'Indo buscar a próxima tarefa', arrived: job.kind === 'deliver' ? 'Tarefa entregue na mesa central' : 'Tarefa recebida · voltando para trabalhar', home: job.kind === 'deliver' ? 'De volta à bancada · passagem concluída' : 'Na bancada, trabalhando na tarefa recebida' };
  if (!messages[phase]) return;
  demoEvent(agent, phase === 'home' ? (job.kind === 'deliver' ? 'idle' : 'writing') : (job.kind === 'deliver' ? 'done' : 'reading'), messages[phase]); render();
} });
reducedMotion.addEventListener('change', () => handoffs.sync());
let runningBeforeLayout = true;
const panelLayout = new PanelLayout({ initial: (() => { try { return JSON.parse(localStorage.getItem(storageKey))?.panelLayout; } catch { return {}; } })(), onSave: remember, notify, onResizeStart: () => handoffs.cancel(false), onEdit: editing => {
  if (editing) { runningBeforeLayout = demoRunning; demoRunning = false; handoffs.cancel(false); handoffs.setPaused(true); }
  else { demoRunning = runningBeforeLayout; handoffs.setPaused(mode === 'demo' && !demoRunning); }
  render();
} });

function notify(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3500); }
function safeConfig(raw) {
  if (!raw || !Array.isArray(raw.agents) || raw.agents.length > 64) throw new Error('Configuração inválida: use até 64 identidades.');
  const base = freshConfig(), ids = new Set();
  const text = (v, max, fallback = '') => typeof v === 'string' ? v.trim().slice(0, max) : fallback;
  const number = (v, min, max, fallback) => typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  const color = (v, fallback) => /^#[a-f0-9]{6}$/i.test(v || '') ? v : fallback;
  base.title = text(raw.title, 32, base.title); base.subtitle = text(raw.subtitle, 80, base.subtitle);
  base.accent = color(raw.accent, base.accent); base.glow = number(raw.glow, 0, 100, 65);
  for (const field of ['motion', 'grid', 'compact']) base[field] = typeof raw[field] === 'boolean' ? raw[field] : base[field];
  base.layout = raw.layout === 'grid' ? 'grid' : 'orbit';
  base.agents = raw.agents.map((a, i) => {
    if (!a || typeof a !== 'object') throw new Error('Agente inválido.');
    const id = text(a.id, 64) || crypto.randomUUID(); if (ids.has(id)) throw new Error('Agentes com identificadores repetidos.'); ids.add(id);
    const sprite = text(a.sprite, 1400000);
    if (sprite && !/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(sprite)) throw new Error('Formato de imagem não aceito.');
    return { id, name: text(a.name, 32, 'Agente'), role: text(a.role, 48, 'Assistente'), provider: ['claude', 'codex', 'custom'].includes(a.provider) ? a.provider : 'custom', color: color(a.color, palette[i % 6].color), hue: number(a.hue, 0, 360, 0), x: number(a.x, 12, 88, 50), y: number(a.y, 25, 84, 50), scale: number(a.scale, 65, 125, 100), sprite, binding: text(a.binding, 200), sessionOnly: a.sessionOnly === true || id.startsWith('session-avatar-') };
  });
  base.agents = migrateFormation(base.agents);
  if (JSON.stringify(base).length > 6_000_000) throw new Error('As imagens somadas precisam ocupar menos de 6 MB.');
  return base;
}
function safeTasks(raw) {
  if (!Array.isArray(raw) || raw.length > 100) return freshTasks();
  return raw.filter(t => t && typeof t.title === 'string').map(t => ({ id: typeof t.id === 'string' ? t.id.slice(0, 64) : crypto.randomUUID(), title: t.title.slice(0, 80), description: typeof t.description === 'string' ? t.description.slice(0, 200) : '', status: ['queued', 'active', 'done'].includes(t.status) ? t.status : 'queued', agentId: typeof t.agentId === 'string' ? t.agentId.slice(0, 64) : '' }));
}
function remember() {
  try { localStorage.setItem(storageKey, JSON.stringify({ config, tasks, mode, panelLayout: panelLayout.snapshot() })); } catch { notify('O navegador está sem espaço para salvar. Exporte sua configuração.'); }
}
async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.'); return result;
}
function saveConfig() {
  remember();
  if (!bridgeReady) return;
  const next = structuredClone(config);
  pendingSaves++;
  saveQueue = saveQueue.catch(() => {}).then(() => api('/api/config', 'PUT', next)).catch(error => notify(error.message)).finally(() => { pendingSaves--; });
}
function demoEvent(agent, status, message) {
  demoAgents[agent.id] = { status, message, count: (demoAgents[agent.id]?.count || 0) + 1 };
  demoEvents.unshift({ id: crypto.randomUUID(), agentId: agent.id, name: agent.name, provider: agent.provider, status, message, color: agent.color, timestamp: new Date().toISOString() });
  demoEvents = demoEvents.slice(0, 100); demoCount++;
}
function demoCharacters() { return config.agents.filter(a => !a.sessionOnly); }
function seedDemo() {
  handoffs.cancel();
  demoAgents = {}; demoEvents = []; demoCount = 0;
  const states = ['writing', 'reading', 'done'];
  const messages = ['Montando a interface do projeto', 'Explorando novas possibilidades', 'Tudo pronto para a próxima ideia'];
  demoCharacters().forEach((a, i) => demoEvent(a, states[i % 3], messages[i % 3]));
}
function demoTick() {
  if (mode !== 'demo' || panelLayout.editing || !demoRunning || handoffs.busy || !demoCharacters().length) return;
  startDemoTransfer();
}
function startDemoTransfer() {
  if (handoffs.busy) { notify('Uma passagem já está em andamento.'); return; }
  const characters = demoCharacters();
  if (!characters.length) { notify('Adicione um companheiro para testar a passagem.'); return; }
  const source = characters[demoStep % characters.length], target = characters[(demoStep + 1) % characters.length];
  const title = tasks.find(t => t.agentId === source.id)?.title || 'Uma nova ideia para o projeto';
  demoStep++;
  handoffs.enqueue({ agentId: source.id, kind: 'deliver', title, mode: 'demo' });
  handoffs.enqueue({ agentId: target.id, kind: 'pickup', title, mode: 'demo' });
}
function visibleAgents() {
  if (mode === 'live') return liveSessions().flatMap(s => liveTeam(config.agents, displayedSessionAgents(runtime, s.id, !!observationSession), s)).map(a => {
    const appearance = palette[[...a.runtimeId].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % palette.length];
    return { ...a, color: a.color || appearance.color, hue: a.hue ?? appearance.hue, scale: a.scale || 100, x: a.x ?? 50, y: a.y ?? 50 };
  });
  const configured = demoCharacters().map((a, i) => {
    const activity = demoAgents[a.id];
    return { ...a, status: activity?.status || 'idle', message: activity?.message || 'Aguardando uma nova ideia', count: activity?.count || 0, configured: true };
  });
  return configured;
}
function layoutPositions(agents) {
  const positions = formationPositions(agents.length);
  return agents.map((a, i) => {
    if (config.layout === 'grid' || agents.length > 5) return { ...a, ...positions[i] };
    if (mode === 'live') {
      const key = scenePositionKey(a.sessionId, a.runtimeId);
      return { ...a, ...(scenePositions[key] || positions[i]) };
    }
    return a.configured ? a : { ...a, ...positions[i] };
  });
}
const agentStyle = a => `--agent-color:${a.color};--hue:${characterHue(a)};`;
function stationHtml(a, i) {
  const busy = activeStatuses.includes(a.status);
  const bat = characterSkinId(a.sprite) === 'holographic-bat';
  const bars = Array.from({ length: 12 }, (_, n) => `<i style="--bar:${3 + ((n * 7 + i * 3) % 14)}px;--d:${n * -.17}s"></i>`).join('');
  return `<button class="station state-${a.status} ${busy ? 'busy' : ''} ${bat ? 'bat-sprite' : ''} ${selected === a.id ? 'selected' : ''}" data-action="select-agent" data-id="${esc(a.id)}" style="${agentStyle(a)}--x:${a.x};--y:${a.y};--scale:${a.scale / 100};--delay:${i * -.8}s" aria-label="${esc(a.name)}: ${esc(a.connection === 'awaiting-event' && a.status === 'waiting' ? 'Aguardando evento' : statusNames[a.status])}. Clique para detalhes." title="${esc(a.name)} · ${esc(a.connection === 'awaiting-event' && a.status === 'waiting' ? 'Aguardando evento' : statusNames[a.status])}">
    ${a.status === 'waiting' ? `<span class="event-bubble">${a.connection === 'awaiting-event' ? 'Aguardando evento' : 'Preciso de você ✦'}</span>` : ''}
    <div class="mascot-wrap ${bat ? 'bat-wrap' : ''}">${bat ? `<span class="bat-mascot" aria-hidden="true"><img class="bat-wing bat-wing-left" draggable="false" src="${esc(spriteUrl(a))}" alt=""/><img class="mascot bat-body" draggable="false" src="${esc(spriteUrl(a))}" alt=""/><img class="bat-wing bat-wing-right" draggable="false" src="${esc(spriteUrl(a))}" alt=""/></span>` : `<img class="mascot" draggable="false" src="${esc(spriteUrl(a))}" alt=""/>`}</div>
    <div class="station-plinth"><span class="provider-mark">${a.provider === 'codex' ? 'CX' : a.provider === 'claude' ? 'CL' : '✦'}</span><div class="station-name">${esc(a.name.toUpperCase())}</div><div class="station-role">${esc(a.role)}</div>${a.conversationLabel ? `<div class="conversation-label" title="${esc(a.conversationLabel)}">${esc(a.conversationLabel)}</div>` : ''}<div class="station-bars" aria-hidden="true">${bars}</div><div class="station-state">${esc(a.connection === 'awaiting-event' && a.status === 'waiting' ? 'Aguardando evento' : statusNames[a.status])}</div></div>
  </button>`;
}
function renderScene(agents) {
  const positioned = layoutPositions(agents), scene = $('#scene');
  scene.classList.toggle('many', agents.length > 5); scene.classList.toggle('grid-layout', config.layout === 'grid' || agents.length > 5);
  if (!drag) $('#stations').innerHTML = positioned.map(stationHtml).join('');
  $('#connection-lines').innerHTML = positioned.map(a => `<line x1="500" y1="357" x2="${a.x * 10}" y2="${a.y * 7}" stroke="${a.color}"/>`).join('');
  $('#scene-empty').hidden = agents.length > 0;
  $('#scene-empty h3').textContent = mode === 'live' ? 'Nenhuma conversa em atividade' : 'Um universo em branco';
  $('#scene-empty p').textContent = mode === 'live' ? 'Envie uma instrução no chat ou selecione uma conversa no Mission Board para consultar o histórico.' : 'Os personagens acompanham os agentes criados pelo Codex.';
  $('#scene-tip').textContent = agents.length > 5 ? 'Clique em um agente para ver os detalhes · grade automática acima de cinco' : config.layout === 'grid' ? 'Clique em um agente para ver detalhes · alterne para órbita para organizar' : 'Clique para conhecer · arraste para organizar';
  $('#demo-toggle').hidden = mode !== 'demo';
  $('#simulate-handoff').hidden = mode !== 'demo';
  $('#demo-toggle').disabled = panelLayout.editing;
  $('#simulate-handoff').disabled = panelLayout.editing;
  $('#demo-toggle').innerHTML = icon(demoRunning ? 'pause' : 'play') + (demoRunning ? ' Pausar demo' : ' Continuar demo');
  $('#floor-badge').innerHTML = '<span class="dot"></span> ' + (mode === 'demo' ? 'DEMO' : Object.keys(runtime.agents).length ? 'EVENTOS REAIS' : 'AGUARDANDO');
  handoffs.sync();
  panelLayout.apply();
}
function renderCrew(agents) {
  $('#crew-list').innerHTML = agents.length ? agents.map(a => `<button class="crew-row ${selected === a.id ? 'selected' : ''}" data-action="select-agent" data-id="${esc(a.id)}" style="${agentStyle(a)}"><img class="crew-mini" src="${esc(spriteUrl(a))}" alt=""/><span class="crew-copy"><strong>${esc(a.name)}</strong><small>${esc(a.role)} · ${esc(providerNames[a.provider])}</small>${a.conversationLabel ? `<small class="conversation-label" title="${esc(a.conversationLabel)}">${esc(a.conversationLabel)}</small>` : ''}</span><span class="status-pill">${esc(a.connection === 'awaiting-event' && a.status === 'waiting' ? 'Aguardando evento' : statusNames[a.status])}</span></button>`).join('') : mode === 'live' ? '<p class="empty-copy">Nenhuma equipe em atividade.<br>Consulte uma conversa no Mission Board.</p>' : '<p class="empty-copy">Os personagens acompanham os agentes criados pelo Codex.</p>';
  $('#crew-count').textContent = `${agents.length} ${agents.length === 1 ? 'companheiro' : 'companheiros'}`;
}
function currentEvents() { const ids = new Set(liveSessions().map(s => s.id)); return mode === 'demo' ? demoEvents : runtime.events.filter(e => ids.has(e.sessionId)); }
function eventColor(event) { return visibleAgents().find(a => a.runtimeId === event.agentId || a.id === event.agentId)?.color || config.agents.find(a => a.id === event.agentId || a.binding === event.agentId)?.color || event.color || (event.provider === 'codex' ? '#55c8ff' : '#be8bff'); }
function timeLabel(timestamp) { return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function renderFeed() {
  const events = currentEvents();
  $('#feed-list').innerHTML = events.length ? events.slice(0, 12).map(e => `<div class="feed-item" style="--agent-color:${eventColor(e)}"><span class="feed-dot"></span><div class="feed-content"><strong>${esc(e.name)}</strong><p>${esc(e.message)}</p></div><time class="feed-time">${timeLabel(e.timestamp)}</time></div>`).join('') : '<p class="empty-copy">O silêncio antes de uma boa ideia.<br>Os próximos eventos aparecerão aqui.</p>';
  $('#feed-source').textContent = mode === 'demo' ? 'EVENTOS DE EXEMPLO' : 'EVENTOS DOS CONECTORES';
  $('[data-action="clear-feed"]').hidden = mode !== 'demo';
}
function renderTasks() {
  const live = mode === 'live', shown = boardTasks(), session = liveSessions()[0];
  $('#live-session').hidden = !live;
  const sessions = Object.values(runtime.observation?.sessions || {}).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  $('#live-session').innerHTML = '<option value="">Conversas em atividade</option>' + sessions.map(s => `<option value="${esc(s.id)}" ${observationSession === s.id ? 'selected' : ''}>${esc(s.title)} · ${esc(s.id.slice(-8))}</option>`).join('');
  $('[data-action="add-task"]').hidden = live;
  $('.board-note').textContent = live ? (session ? 'Quadro do plano principal · entregas de subagentes exigem validação.' : 'Nenhuma conversa em atividade. Selecione uma conversa acima para consultar seu histórico.') : 'Seu quadro de organização local. Você decide as etapas.';
  const columns = [['queued', 'NA FILA'], ['active', 'EM ANDAMENTO'], ['done', 'CONCLUÍDO']];
  $('#mission-board').innerHTML = columns.map(([status, label]) => {
    const items = shown.filter(t => t.status === status);
    return `<div class="board-column"><div class="column-title">${label}<span>${items.length}</span></div>${items.length ? items.map(task => {
      const agent = live ? visibleAgents().find(a => a.runtimeId === task.agentId) : config.agents.find(a => a.id === task.agentId);
      return `<article class="task-card" title="${live ? esc('Cartão: ' + (task.externalId || task.id)) : ''}">${live ? '' : `<button class="task-delete" data-action="delete-task" data-id="${esc(task.id)}" title="Remover tarefa" aria-label="Remover ${esc(task.title)}">×</button>`}<p class="task-title">${esc(task.title)}</p><p class="task-description">${esc(task.description)}</p>${live ? `<div class="conversation-label" title="${esc(task.conversationLabel)}">${esc(task.conversationLabel)}</div>` : ''}<div class="task-bottom"><span class="task-agent" style="--agent-color:${agent?.color || '#927aa5'}"><span class="dot"></span><span>${esc(agent?.name || (live ? 'Principal' : 'Você'))}</span></span>${live ? '' : `<button class="task-next" data-action="advance-task" data-id="${esc(task.id)}" title="Mover etapa">${icon(status === 'done' ? 'check' : 'arrow')}</button>`}</div></article>`;
    }).join('') : '<div class="column-empty">Espaço para uma nova ideia</div>'}</div>`;
  }).join('');
  const archived = live ? liveSessions().flatMap(s => (s.archivedTasks || []).map(t => ({ ...t, conversation: s.title }))) : [];
  $('#replaced-cards').hidden = !archived.length;
  $('#replaced-summary').textContent = `Cartões substituídos · ${archived.length}`;
  $('#replaced-list').innerHTML = archived.map(t => `<div class="archived-card"><strong>${esc(t.title)}</strong><span>${esc(t.conversation)} · ${esc(t.archiveReason)}</span><small>Estado anterior: ${esc({queued:'Na fila',active:'Em andamento',done:'Concluído'}[t.status] || t.status)}</small></div>`).join('');
}
function renderActivity() {
  const now = Date.now(), counts = Array(10).fill(0);
  for (const event of currentEvents()) { const bin = 9 - Math.floor((now - new Date(event.timestamp).getTime()) / 60000); if (bin >= 0 && bin < 10) counts[bin]++; }
  const max = Math.max(4, ...counts);
  $('#activity-chart').innerHTML = counts.map((count, i) => `<div class="chart-bar" style="height:${Math.max(2, count / max * 85)}px" title="${10 - i} min atrás: ${count} eventos${mode === 'demo' ? ' simulados' : ''}"></div>`).join('');
  $('#provider-summary').innerHTML = ['codex', 'claude'].map(provider => {
    const timestamp = runtime.providers[provider], recent = mode === 'live' && timestamp && now - new Date(timestamp).getTime() < 90000;
    return `<span class="provider-chip ${recent ? 'receiving' : ''}"><span class="dot"></span>${providerNames[provider]} · ${mode === 'demo' ? 'demo' : recent ? 'recebendo' : timestamp ? 'sem evento recente' : 'aguardando'}</span>`;
  }).join('');
}
function renderMetrics(agents) {
  $('#metric-agents').textContent = String(agents.length).padStart(2, '0');
  $('#metric-agent-meta').textContent = mode === 'demo' ? 'configuráveis' : 'no painel';
  $('#metric-active').textContent = String(agents.filter(a => activeStatuses.includes(a.status)).length).padStart(2, '0');
  const shown = boardTasks();
  $('#metric-tasks').innerHTML = `${String(shown.filter(t => t.status === 'done').length).padStart(2, '0')}<span> / ${String(shown.length).padStart(2, '0')}</span>`;
  $('#metric-events').textContent = String(mode === 'demo' ? demoCount : liveSessions().reduce((n, s) => n + (s.totalEvents || 0), 0)).padStart(2, '0');
  $('#metric-events-meta').textContent = mode === 'demo' ? 'simulados' : observationSession ? 'nesta conversa' : 'nas conversas ativas';
}
function renderTheme() {
  document.documentElement.style.setProperty('--accent', config.accent);
  document.documentElement.style.setProperty('--glow', config.glow / 100);
  document.body.classList.toggle('no-motion', !config.motion); document.body.classList.toggle('no-grid', !config.grid); document.body.classList.toggle('compact', config.compact);
  $('#brand-title').innerHTML = `${esc(config.title || 'NEXUS')}<span>DESK</span>`;
  $('#mode-banner').classList.toggle('real', mode === 'live');
  $('#mode-title').textContent = mode === 'demo' ? 'MODO DEMONSTRAÇÃO' : 'MODO CONECTADO';
  $('#mode-description').textContent = mode === 'demo' ? 'Uma prévia viva do seu próximo projeto.' : 'Acompanhando eventos enviados pelas suas ferramentas.';
  $('#bridge-label').textContent = bridgeReady ? 'Ponte local disponível' : 'Ponte local offline';
  $('#bridge-dot').style.background = bridgeReady ? '#80d7a9' : '#da9d68';
}
function render() {
  const agents = visibleAgents();
  renderTheme(); renderMetrics(agents); renderScene(agents); renderCrew(agents); renderFeed(); renderTasks(); renderActivity();
  if (selected) renderDetail();
}

function renderDetail() {
  const agent = visibleAgents().find(a => a.id === selected);
  if (!agent) { selected = null; $('#agent-detail').hidden = true; return; }
  const el = $('#agent-detail'); el.hidden = false; el.style.cssText = agentStyle(agent);
  const events = currentEvents().filter(e => e.agentId === (mode === 'live' ? agent.runtimeId : agent.id)).slice(0, 6);
  el.innerHTML = `<div class="detail-top"><span class="eyebrow">SEU COMPANHEIRO</span><button class="icon-button" data-action="close-detail" title="Fechar detalhes">${icon('close')}</button></div><div class="detail-portrait" style="${agentStyle(agent)}"><img src="${esc(spriteUrl(agent))}" alt="${esc(agent.name)}"/></div><h2 class="detail-name">${esc(agent.name)}</h2><p class="detail-role">${esc(agent.role)} · ${esc(providerNames[agent.provider])}</p><div class="detail-status"><span class="dot" style="background:${agent.color}"></span>${esc(statusNames[agent.status])}${mode === 'demo' ? ' · demonstração' : ''}</div><div class="detail-section"><p class="eyebrow">ÚLTIMA ATIVIDADE</p><p class="detail-message">${esc(agent.message)}</p></div><div class="detail-actions"><button class="button ghost" data-action="edit-agent" data-id="${esc(agent.id)}">${icon('edit')} Editar</button>${mode === 'demo' ? `<button class="button primary" data-action="agent-demo" data-id="${esc(agent.id)}">${icon('play')} Testar ação</button>` : ''}</div><p class="detail-note">${mode === 'demo' ? 'Este personagem demonstra estados de trabalho. Ao conectar uma ferramenta, os movimentos acompanham os eventos reais.' : 'Acompanhamento visual. Aprovações e execução continuam na ferramenta de origem.'}</p><div class="detail-section"><p class="eyebrow">PEQUENAS CONQUISTAS</p>${events.length ? events.map(e => `<div class="detail-log"><time>${timeLabel(e.timestamp)}</time>${esc(e.message)}</div>`).join('') : '<p class="empty-copy">Ainda sem eventos para este agente.</p>'}</div>`;
}
function openSettings(tab = 'agents') { activeTab = tab; renderSettings(); $('#settings-dialog').showModal(); }
function renderSettings() {
  $$('.dialog-tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === activeTab));
  const content = $('#settings-content');
  if (activeTab === 'agents') {
    const editableAgents = mode === 'live' ? visibleAgents() : demoCharacters();
    content.innerHTML = `<p class="settings-intro">O Codex principal cria os agentes e delega o trabalho no chat. Aqui você personaliza o nome, a cor e a skin dos personagens.</p>${editableAgents.length ? editableAgents.map(a => `<div class="settings-agent" style="${agentStyle(a)}"><img src="${esc(spriteUrl(a))}" alt=""/><div class="settings-agent-text"><strong>${esc(a.name)}</strong><small>${esc(a.role)} · ${esc(providerNames[a.provider])}</small>${a.conversationLabel ? `<small class="conversation-label">${esc(a.conversationLabel)}</small>` : ''}</div><button class="button ghost" data-action="edit-agent" data-id="${esc(a.id)}">Editar</button></div>`).join('') : '<p class="empty-copy">Nenhum agente nesta visualização. Escolha uma conversa no Mission Board para editar seus personagens.</p>'}<hr class="settings-divider"><p class="settings-label">Leve seu universo com você</p><div class="settings-toolbar"><button class="button ghost" data-action="export">${icon('download')} Exportar configuração</button><button class="button ghost" data-action="import">Importar configuração</button></div><p class="form-hint">Inclui aparência e quadro de tarefas. Sem credenciais dos conectores.</p>`;
  } else if (activeTab === 'appearance') {
    content.innerHTML = `<p class="settings-intro">O mesmo universo, com a sua assinatura. Os ajustes aparecem na hora.</p><div class="form-grid"><div class="form-field full"><label for="panel-title">Nome do universo</label><input class="field" id="panel-title" maxlength="32" value="${esc(config.title)}" data-setting="title"></div><div class="form-field full"><label>Cor de destaque</label><div class="color-options">${['#68e8f9', '#ba93ef', '#f58acb', '#89e3b7', '#f4cd84'].map(c => `<button class="color-swatch ${config.accent === c ? 'selected' : ''}" style="--swatch:${c}" data-action="accent" data-color="${c}" aria-label="Usar cor ${c}"></button>`).join('')}<input type="color" class="color-input" value="${config.accent}" data-setting="accent" aria-label="Outra cor de destaque"></div></div><div class="form-field full"><label for="glow-range">Intensidade do neon</label><div class="range-row"><input id="glow-range" type="range" min="0" max="100" value="${config.glow}" data-setting="glow"><output>${config.glow}%</output></div></div><div class="form-field full"><label for="layout-select">Organização dos personagens</label><select class="field" id="layout-select" data-setting="layout"><option value="orbit" ${config.layout === 'orbit' ? 'selected' : ''}>Órbita · posições livres</option><option value="grid" ${config.layout === 'grid' ? 'selected' : ''}>Grade · mesas organizadas</option></select><p class="form-hint">Acima de cinco agentes, a grade mantém o espaço legível.</p></div></div><hr class="settings-divider">${[['motion', 'Dar vida aos personagens', 'Respiração, flutuação e ritmo de trabalho.'], ['grid', 'Piso holográfico', 'Linhas em perspectiva no centro de comando.'], ['compact', 'Universo compacto', 'Personagens menores e mais espaço na tela.']].map(([key, label, hint]) => `<label class="toggle-row"><span>${label}<small>${hint}</small></span><input type="checkbox" data-setting="${key}" ${config[key] ? 'checked' : ''}></label>`).join('')}`;
  } else {
    const realCount = Object.keys(runtime.agents).length;
    content.innerHTML = `<p class="settings-intro">O painel fala uma linguagem comum de eventos. Claude Code e Codex têm adaptadores separados para alimentar o mesmo universo.</p><div class="connection-mode"><button data-action="mode" data-mode="demo" class="${mode === 'demo' ? 'active' : ''}">Demonstração</button><button data-action="mode" data-mode="live" class="${mode === 'live' ? 'active' : ''}">Eventos reais</button></div><div class="connection-card"><div class="connection-header"><h4>${icon('terminal')} Ponte local</h4><span class="connection-tag">${bridgeReady ? 'DISPONÍVEL' : 'OFFLINE'}</span></div><p>${bridgeReady ? 'Servidor ativo neste computador. Os conectores podem enviar atividade para o painel.' : 'Inicie o servidor com node server.mjs na pasta do projeto para habilitar os conectores.'}</p><pre>${esc(integrations?.endpoint || 'http://127.0.0.1:4318/api/events')}</pre><p>${realCount} ${realCount === 1 ? 'sessão observada' : 'sessões observadas'} desde que a ponte foi iniciada.</p></div><div class="connection-card"><div class="connection-header"><h4>Claude Code</h4><span class="connection-tag">HOOKS</span></div><p>Execute npm run setup e escolha Claude Code para configurar seu perfil, inclusive projetos futuros. A configuração manual por projeto também está disponível abaixo. Consulte o README.</p><button class="button ghost" data-action="copy-claude" ${!integrations ? 'disabled' : ''}>Copiar configuração dos hooks</button><p class="form-hint">Nenhum arquivo de configuração do Claude é alterado por esta tela.</p></div><div class="connection-card"><div class="connection-header"><h4>Codex · acompanhar o chat</h4><span class="connection-tag">HOOKS</span></div><p>Execute npm run setup e escolha Codex. Recarregue o cliente e revise os hooks quando solicitado. Planos e delegações reais alimentam o painel em Eventos reais.</p><p class="form-hint">Sem novas execuções de CLI a cada mensagem. A instalação precisa ser homologada na sua versão do aplicativo.</p></div><div class="connection-card"><div class="connection-header"><h4>Codex CLI · teste avulso</h4><span class="connection-tag">JSON STREAM</span></div><p>Execute este comando na pasta do software que deseja analisar. A atividade do CLI aparece aqui durante a execução.</p><pre>${esc(integrations?.codex || 'codex exec --json "Descreva este projeto" | node scripts/codex-stream.mjs')}</pre><button class="button ghost" data-action="copy-codex" ${!integrations ? 'disabled' : ''}>Copiar comando</button><p class="warning-copy">O comando inicia uma tarefa real no Codex CLI. Esta versão não observa automaticamente conversas já abertas no aplicativo Codex.</p></div>${realCount ? `<div class="observed-list"><p class="settings-label">Sessões que já enviaram eventos</p>${Object.values(runtime.agents).slice(-12).map(a => `<div class="observed-row"><div>${esc(a.name)}<small>${esc(providerNames[a.provider])} · ${esc(a.connection === 'awaiting-event' && a.status === 'waiting' ? 'Aguardando evento' : statusNames[a.status])}</small></div><span class="connection-tag">Automático</span></div>`).join('')}</div>` : ''}<p class="form-hint">Esta primeira versão acompanha atividade. Ela não inicia equipes nem aprova ferramentas pelo navegador. O protocolo está documentado para futuras integrações.</p>`;
  }
}

async function openAgentEditor(id) {
  const actual = visibleAgents().find(a => a.id === id);
  const runtimeId = mode === 'live' ? actual?.runtimeId : '';
  const existing = runtimeId
    ? config.agents.find(a => a.sessionOnly && a.binding === runtimeId)
    : config.agents.find(a => a.id === id);
  if (!existing && !actual) return;
  if (!existing && config.agents.length >= 64) { notify('O limite de identidades visuais salvas foi atingido.'); return; }
  let skins;
  try { skins = await loadCharacterSkins(); } catch (error) { notify(error.message); return; }
  const p = palette[config.agents.length % palette.length];
  editorDraft = existing ? structuredClone(existing) : {
    ...p, x: 50, y: 50, scale: 100, sprite: '', ...actual,
    id: `${runtimeId ? 'session-avatar-' : ''}${crypto.randomUUID()}`, binding: runtimeId || actual.agentId || '', sessionOnly: !!runtimeId
  };
  const skinChoices = skins.some(skin => skin.sprite === editorDraft.sprite) ? skins : [...skins, { id: 'custom', name: 'Imagem atual', url: editorDraft.sprite, sprite: editorDraft.sprite }];
  $('#editor-content').innerHTML = `<div class="dialog-top"><div><p class="eyebrow">IDENTIDADE DO PERSONAGEM</p><h2>Do seu jeito.</h2>${actual?.conversationLabel ? `<p class="form-hint">Somente nesta conversa: ${esc(actual.conversationLabel)}</p>` : ''}</div><button class="icon-button" data-action="close-editor" title="Fechar">${icon('close')}</button></div><form id="agent-form" class="editor-body"><div class="preview-mascot" id="editor-preview" style="--hue:${characterHue(editorDraft)}"><img src="${esc(spriteUrl(editorDraft))}" alt="Prévia do personagem"/></div><div class="form-grid"><div class="form-field full"><label for="agent-name">Nome</label><input class="field" id="agent-name" name="name" maxlength="32" required value="${esc(editorDraft.name)}"></div><div class="form-field full"><label>Skin</label><div class="skin-options" role="group" aria-label="Skin do personagem">${skinChoices.map((skin, i) => `<button type="button" class="skin-option ${skin.sprite === editorDraft.sprite ? 'selected' : ''}" data-action="agent-skin" data-skin="${i}" aria-pressed="${skin.sprite === editorDraft.sprite}" aria-label="${esc(skin.name)}"><img src="${esc(skin.url)}" alt=""/><span>${esc(skin.name)}</span></button>`).join('')}</div></div><div class="form-field full"><label>Cor do personagem e do posto</label><div class="color-options">${palette.map((p, i) => `<button type="button" class="color-swatch ${editorDraft.color === p.color ? 'selected' : ''}" style="--swatch:${p.color}" data-action="agent-color" data-index="${i}" aria-label="${p.label}"></button>`).join('')}</div></div></div><p class="form-hint">A função e a execução são definidas no chat. A cor personaliza o personagem e sua bancada. A edição de um agente conectado vale somente para a conversa indicada.</p><div class="editor-footer"><button type="button" class="button ghost" data-action="close-editor">Cancelar</button><button type="submit" class="button primary">Salvar personagem</button></div></form>`;
  $('#agent-form').nexusSkins = skinChoices;
  $('#editor-dialog').showModal();
  requestAnimationFrame(() => $('#agent-name').focus());
}
function openTaskEditor() {
  if (tasks.length >= 100) { notify('O quadro comporta até 100 tarefas.'); return; }
  $('#editor-content').innerHTML = `<div class="dialog-top"><div><p class="eyebrow">A PRÓXIMA PEQUENA CONQUISTA</p><h2>Uma ideia começa aqui.</h2></div><button class="icon-button" data-action="close-editor" title="Fechar">${icon('close')}</button></div><form id="task-form" class="editor-body task-editor"><div class="form-grid"><div class="form-field full"><label for="task-title">O que você quer fazer?</label><input class="field" id="task-title" name="title" maxlength="80" required placeholder="Ex.: criar a página inicial"></div><div class="form-field full"><label for="task-description">Um pouco mais de contexto</label><textarea class="field" id="task-description" name="description" maxlength="200" placeholder="Qual será o primeiro passo?"></textarea></div><div class="form-field"><label for="task-agent">Companheiro</label><select class="field" id="task-agent" name="agentId"><option value="">Você</option>${config.agents.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div><div class="form-field"><label for="task-status">Etapa</label><select class="field" id="task-status" name="status"><option value="queued">Na fila</option><option value="active">Em andamento</option><option value="done">Concluído</option></select></div></div><p class="form-hint">Organização local: adicionar uma tarefa não inicia execução na ferramenta.</p><div class="editor-footer"><button type="button" class="button ghost" data-action="close-editor">Cancelar</button><button type="submit" class="button primary">Adicionar tarefa</button></div></form>`;
  $('#editor-dialog').showModal(); requestAnimationFrame(() => $('#task-title').focus());
}

function exportSettings() {
  const blob = new Blob([JSON.stringify({ format: 'nexus-desk', version: 1, config, tasks, panelLayout: panelLayout.snapshot() }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'meu-universo-nexus.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); notify('Configuração exportada.');
}
async function copyText(value) {
  try { await navigator.clipboard.writeText(value); notify('Copiado.'); }
  catch { notify('A cópia foi bloqueada pelo navegador. Consulte o README.'); }
}

document.addEventListener('click', async event => {
  const tab = event.target.closest('[data-tab]'); if (tab) { activeTab = tab.dataset.tab; renderSettings(); return; }
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action, id = button.dataset.id;
  if (action === 'select-agent') {
    if (suppressClick) { suppressClick = false; return; }
    selected = id; render(); $('#agent-detail .icon-button')?.focus();
  }
  else if (action === 'close-detail') { selected = null; $('#agent-detail').hidden = true; render(); }
  else if (action === 'edit-layout') panelLayout.toggle();
  else if (action === 'reset-panel-layout') panelLayout.reset();
  else if (action === 'overview') { $('#settings-dialog').close(); selected = null; $('#agent-detail').hidden = true; window.scrollTo({ top: 0, behavior: config.motion ? 'smooth' : 'instant' }); }
  else if (['agents', 'appearance', 'connections'].includes(action)) openSettings(action);
  else if (action === 'close-dialog') $('#settings-dialog').close();
  else if (action === 'close-editor') $('#editor-dialog').close();
  else if (action === 'edit-agent') openAgentEditor(id);
  else if (action === 'layout') { handoffs.cancel(false); config.layout = config.layout === 'orbit' ? 'grid' : 'orbit'; saveConfig(); render(); notify(config.layout === 'grid' ? 'Mesas organizadas em grade.' : 'Órbita livre. Arraste seus personagens.'); }
  else if (action === 'demo-toggle') { demoRunning = !demoRunning; handoffs.setPaused(!demoRunning); render(); }
  else if (action === 'simulate-handoff') { demoRunning = true; handoffs.setPaused(false); startDemoTransfer(); render(); }
  else if (action === 'agent-demo') {
    const agent = config.agents.find(a => a.id === id); if (!agent) return;
    const states = ['reading', 'writing', 'running', 'done', 'waiting', 'idle'];
    const next = states[(states.indexOf(demoAgents[id]?.status) + 1) % states.length]; demoEvent(agent, next, `Demonstração: ${statusNames[next].toLowerCase()}`); render();
  }
  else if (action === 'clear-feed') { demoEvents = []; demoCount = 0; render(); }
  else if (action === 'mode') { handoffs.cancel(); handoffs.setPaused(false); demoRunning = true; mode = button.dataset.mode; selected = null; $('#agent-detail').hidden = true; remember(); render(); renderSettings(); notify(mode === 'demo' ? 'Demonstração ativada.' : 'Aguardando eventos reais dos conectores.'); }
  else if (action === 'accent') { config.accent = button.dataset.color; saveConfig(); render(); renderSettings(); }
  else if (action === 'agent-skin') {
    const form = $('#agent-form'), skin = form?.nexusSkins?.[Number(button.dataset.skin)];
    if (!editorDraft || !skin) return;
    editorDraft.sprite = skin.sprite;
    $('#editor-preview img').src = spriteUrl(editorDraft);
    $('#editor-preview').style.setProperty('--hue', characterHue(editorDraft));
    $$('.skin-option', form).forEach(option => { const active = option === button; option.classList.toggle('selected', active); option.setAttribute('aria-pressed', String(active)); });
  }
  else if (action === 'agent-color') {
    const p = palette[Number(button.dataset.index)]; editorDraft.color = p.color; editorDraft.hue = p.hue;
    $$('.color-swatch', $('#agent-form')).forEach(s => s.classList.toggle('selected', s === button));
    $('#editor-preview').style.setProperty('--hue', characterHue(editorDraft));
  }
  else if (action === 'add-task' && mode === 'demo') openTaskEditor();
  else if (action === 'advance-task' && mode === 'demo') { const task = tasks.find(t => t.id === id); if (!task) return; task.status = { queued: 'active', active: 'done', done: 'queued' }[task.status]; remember(); render(); }
  else if (action === 'delete-task' && mode === 'demo') { tasks = tasks.filter(t => t.id !== id); remember(); render(); notify('Tarefa removida do quadro.'); }
  else if (action === 'export') exportSettings();
  else if (action === 'import') $('#import-file').click();
  else if (action === 'copy-claude' && integrations) copyText(JSON.stringify(integrations.claude, null, 2));
  else if (action === 'copy-codex' && integrations) copyText(integrations.codex);
  else if (action === 'fullscreen') {
    try { handoffs.cancel(false); if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { notify('Tela cheia indisponível neste navegador.'); }
  }
});
document.addEventListener('fullscreenchange', () => {
  const button = $('[data-action="fullscreen"]'), expanded = !!document.fullscreenElement;
  const label = expanded ? 'Sair da tela cheia' : 'Tela cheia da página';
  button.title = label; button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(expanded));
  button.innerHTML = icon(expanded ? 'collapse' : 'expand');
});
document.addEventListener('input', event => {
  const field = event.target;
  if (field.dataset.setting) {
    const key = field.dataset.setting;
    if (['layout', 'compact'].includes(key)) handoffs.cancel(false);
    config[key] = field.type === 'checkbox' ? field.checked : field.type === 'range' ? Number(field.value) : field.value;
    if (field.type === 'range') field.nextElementSibling.textContent = field.value + '%';
    renderTheme(); renderScene(visibleAgents()); saveConfig();
  }
});
document.addEventListener('change', async event => {
  if (event.target.id === 'live-session') { observationSession = event.target.value; handoffs.cancel(); render(); return; }
  if (event.target.id === 'import-file') {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 8_000_000) throw new Error('A configuração precisa ter menos de 8 MB.');
      const data = JSON.parse(await file.text()); if (data.format !== 'nexus-desk' || data.version !== 1) throw new Error('Escolha uma configuração exportada pelo Nexus Desk.');
      const next = safeConfig(data.config); config = next; tasks = safeTasks(data.tasks); panelLayout.import(data.panelLayout); seedDemo(); saveConfig(); render(); renderSettings(); notify('Seu universo foi importado.');
    } catch (error) { notify(error.message); }
    event.target.value = '';
  }
});
document.addEventListener('submit', event => {
  if (event.target.id === 'agent-form') {
    event.preventDefault(); const data = new FormData(event.target);
    const draft = { ...editorDraft, name: String(data.get('name')).trim() };
    if (!draft.name) { notify('Dê um nome ao seu companheiro.'); return; }
    if (draft.binding && config.agents.some(a => a.id !== draft.id && a.sessionOnly === draft.sessionOnly && a.binding === draft.binding)) { notify('Essa sessão já está vinculada a outro personagem.'); return; }
    const existing = config.agents.some(a => a.id === draft.id);
    const nextAgents = existing ? config.agents.map(a => a.id === draft.id ? draft : a) : [...config.agents, draft];
    try { config = safeConfig({ ...config, agents: nextAgents }); } catch (e) { notify(e.message); return; }
    saveConfig(); $('#editor-dialog').close(); render(); if ($('#settings-dialog').open) renderSettings(); notify('Personagem atualizado.');
  }
  if (event.target.id === 'task-form') {
    event.preventDefault(); const data = new FormData(event.target); const title = String(data.get('title')).trim(); if (!title) return;
    tasks.push({ id: crypto.randomUUID(), title, description: String(data.get('description')).trim(), agentId: data.get('agentId'), status: data.get('status') }); remember(); $('#editor-dialog').close(); render(); notify('Ideia adicionada ao quadro.');
  }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && selected && !$('#settings-dialog').open && !$('#editor-dialog').open) { selected = null; $('#agent-detail').hidden = true; render(); } });
$('#scene').addEventListener('pointerdown', event => {
  const station = event.target.closest('.station');
  if (!station || handoffs.busy || config.layout !== 'orbit' || visibleAgents().length > 5 || event.button !== 0) return;
  const agent = layoutPositions(visibleAgents()).find(a => a.id === station.dataset.id); if (!agent) return;
  drag = { agent, station, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: agent.x, originY: agent.y, moved: false };
  station.setPointerCapture(event.pointerId);
});
$('#scene').addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (handoffs.busy) { endDrag(event, true); return; }
  if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < 7 && !drag.moved) return;
  drag.moved = true; const rect = $('#scene').getBoundingClientRect();
  const next = clampScenePosition({ x: drag.originX + (event.clientX - drag.startX) / rect.width * 100, y: drag.originY + (event.clientY - drag.startY) / rect.height * 100 });
  drag.agent.x = next.x; drag.agent.y = next.y;
  drag.station.style.setProperty('--x', drag.agent.x); drag.station.style.setProperty('--y', drag.agent.y);
});
function endDrag(event, cancelled = false) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const finished = drag; drag = null;
  if (cancelled || handoffs.busy) {
    finished.station.style.setProperty('--x', finished.originX); finished.station.style.setProperty('--y', finished.originY);
    finished.agent.x = finished.originX; finished.agent.y = finished.originY; render(); return;
  }
  if (finished.moved) {
    suppressClick = true;
    if (mode === 'live') {
      scenePositions = saveScenePosition(localStorage, scenePositionsKey, scenePositions, finished.agent.sessionId, finished.agent.runtimeId, finished.agent);
    } else {
      const template = config.agents.find(a => a.id === finished.agent.id);
      if (template) Object.assign(template, { x: finished.agent.x, y: finished.agent.y });
      saveConfig();
    }
    render(); setTimeout(() => { suppressClick = false; }, 150);
  }
}
$('#scene').addEventListener('pointerup', event => endDrag(event));
$('#scene').addEventListener('pointercancel', event => endDrag(event, true));

async function connectBridge() {
  try {
    const session = await api('/api/session'); token = session.token;
    const state = await api('/api/state'); config = safeConfig(state.config); runtime = state.runtime; bridgeReady = true;
    integrations = await api('/api/integrations');
    stream = new EventSource('/api/stream');
    stream.addEventListener('snapshot', e => { const state = JSON.parse(e.data); config = safeConfig(state.config); runtime = state.runtime; bridgeReady = true; render(); });
    stream.addEventListener('config', e => { if (pendingSaves) return; config = safeConfig(JSON.parse(e.data)); render(); });
    stream.addEventListener('runtime', e => {
      const incoming = JSON.parse(e.data), jobs = runtimeTransfers(runtime, incoming); runtime = incoming; render();
      if (mode === 'live' && !panelLayout.editing) for (const job of jobs) {
        const agent = visibleAgents().find(a => a.runtimeId === job.agentId);
        if (agent) handoffs.enqueue({ ...job, agentId: agent.id, mode: 'live' });
      }
      if ($('#settings-dialog').open && activeTab === 'connections' && !$('#editor-dialog').open) renderSettings();
    });
    stream.onerror = () => { bridgeReady = false; renderTheme(); };
    stream.onopen = async () => { bridgeReady = true; renderTheme(); try { token = (await api('/api/session')).token; integrations = await api('/api/integrations'); } catch {} };
    seedDemo(); remember(); render();
  } catch { bridgeReady = false; render(); }
}
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved) { config = safeConfig(saved.config); tasks = safeTasks(saved.tasks); mode = saved.mode === 'live' ? 'live' : 'demo'; }
} catch { /* Local cache is optional; server config is authoritative when available. */ }
seedDemo(); render(); connectBridge();
loadCharacterSkins().then(() => render()).catch(() => {});
$('#clock').textContent = new Date().toLocaleTimeString('pt-BR');
setInterval(demoTick, 6500);
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('pt-BR'); }, 1000);
setInterval(() => { renderActivity(); }, 30000);
setInterval(() => { if (mode === 'live' && !panelLayout.editing && !drag) render(); }, 5000);
