export const panelIds = ['agents', 'crew', 'feed', 'missions', 'activity', 'metric-agents', 'metric-active', 'metric-tasks', 'metric-events'];
export function cleanPanelLayout(raw) {
  const result = {};
  for (const id of panelIds) {
    const item = raw?.[id]; if (!item || typeof item !== 'object') continue;
    const value = {};
    if (Number.isFinite(item.columns)) value.columns = Math.max(id === 'agents' ? 8 : id.startsWith('metric-') ? 4 : 6, Math.min(24, Math.round(item.columns)));
    if (Number.isFinite(item.height)) value.height = Math.max(id === 'agents' ? 460 : id.startsWith('metric-') ? 76 : 170, Math.min(1600, Math.round(item.height)));
    if (Object.keys(value).length) result[id] = value;
  }
  return result;
}
export function columnsForWidth(width, boardWidth, gap = 20) {
  const track = Math.max(1, (boardWidth - gap * 23) / 24);
  return Math.max(1, Math.min(24, Math.round((width + gap) / (track + gap))));
}
export function panelColumns(id, configured, fallback, viewportWidth) {
  return viewportWidth <= 600 ? (id.startsWith('metric-') ? 12 : 24) : configured || fallback;
}
export function adaptivePanelSize(id, viewportWidth, viewportHeight, boardTop, footerHeight, gap = 14) {
  if (viewportWidth < 1500 || id.startsWith('metric-')) return null;
  const available = Math.max(460, Math.min(1100, Math.floor(viewportHeight - boardTop - footerHeight - 16)));
  return { columns: id === 'agents' ? 12 : 6, height: id === 'agents' ? available : Math.max(170, Math.floor((available - gap) / 2)) };
}
export class PanelLayout {
  constructor({ initial, onSave, onResizeStart, onEdit, notify }) {
    this.layout = cleanPanelLayout(initial); Object.assign(this, { onSave, onResizeStart, onEdit, notify });
    this.editing = false; this.drag = null; this.tiles = [];
    const board = document.createElement('div'); board.className = 'layout-board'; board.setAttribute('aria-label', 'Cards do painel');
    const old = document.querySelector('.dashboard-grid'); old.before(board); this.board = board;
    const labels = ['Agentes', 'Equipe', 'Feed de eventos', 'Quadro de tarefas', 'Atividade'];
    ['.universe-panel', '.crew-panel', '.feed-panel', '.mission-panel', '.activity-panel'].forEach((selector, i) => {
      const tile = document.querySelector(selector); board.append(tile); this.prepare(tile, panelIds[i], labels[i]);
    });
    old.remove(); document.querySelector('.bottom-grid').remove();
    document.querySelectorAll('.metric').forEach((tile, i) => this.prepare(tile, panelIds[i + 5], ['Quantidade de agentes', 'Agentes ativos', 'Tarefas concluídas', 'Eventos recebidos'][i]));
    this.apply();
    document.addEventListener('pointerdown', e => this.start(e));
    document.addEventListener('pointermove', e => this.move(e));
    document.addEventListener('pointerup', e => this.end(e));
    document.addEventListener('pointercancel', e => this.end(e, true));
    document.addEventListener('keydown', e => this.key(e));
    window.addEventListener('resize', () => { if (this.drag) this.end(null, true); this.apply(); });
  }
  prepare(tile, id, label) {
    tile.classList.add('layout-tile'); tile.dataset.panel = id;
    if (id !== 'agents') {
      const content = document.createElement('div'); content.className = 'tile-content';
      while (tile.firstChild) content.append(tile.firstChild); tile.append(content);
    }
    for (const [edge, text] of [['e', 'largura'], ['s', 'altura'], ['se', 'largura e altura']]) {
      const handle = document.createElement('button'); handle.type = 'button'; handle.className = `resize-handle resize-${edge}`; handle.dataset.edge = edge;
      handle.setAttribute('aria-label', `Ajustar ${text}: ${label}`); handle.title = `Arraste para ajustar ${text}. Use as setas pelo teclado.`;
      handle.innerHTML = edge === 'se' ? '<span aria-hidden="true">⌟</span>' : ''; tile.append(handle);
    }
    this.tiles.push(tile);
  }
  snapshot() { return structuredClone(this.layout); }
  import(value) { if (this.drag) this.end(null, true); this.layout = cleanPanelLayout(value); this.apply(); this.onSave(); }
  defaults(tile) {
    if (tile.dataset.panel.startsWith('metric-')) return innerWidth <= 600 ? 12 : 6;
    if (innerWidth <= 950) return 24;
    if (innerWidth >= 1500) return tile.dataset.panel === 'agents' ? 12 : 6;
    const sidebar = innerWidth >= 1550 ? 360 : innerWidth <= 1180 ? 280 : 315;
    const right = Math.max(6, Math.min(10, columnsForWidth(sidebar, this.board.clientWidth)));
    return ['agents', 'missions'].includes(tile.dataset.panel) ? 24 - right : right;
  }
  apply() {
    // Content above the grid is measured, so zoom, editing controls and custom
    // metric sizes all participate in the remaining-height calculation.
    const boardTop = this.board.getBoundingClientRect().top + window.scrollY;
    const footerHeight = document.querySelector('.app-footer').offsetHeight;
    const gap = parseFloat(getComputedStyle(this.board).rowGap) || 14;
    for (const tile of this.tiles) {
      const item = this.layout[tile.dataset.panel];
      const adaptive = adaptivePanelSize(tile.dataset.panel, innerWidth, innerHeight, boardTop, footerHeight, gap);
      tile.style.setProperty('--tile-columns', panelColumns(tile.dataset.panel, item?.columns, this.defaults(tile), innerWidth));
      tile.classList.toggle('tile-sized', !!item?.height);
      tile.classList.toggle('tile-adaptive-height', !!adaptive && !item?.height);
      if (item?.height || adaptive) tile.style.setProperty('--tile-height', `${item?.height || adaptive.height}px`); else tile.style.removeProperty('--tile-height');
      tile.querySelectorAll('.resize-handle').forEach(h => { h.hidden = !this.editing; h.disabled = !this.editing; });
      tile.querySelector('.resize-e').setAttribute('aria-valuetext', `${item?.columns || this.defaults(tile)} de 24 colunas`);
      tile.querySelector('.resize-s').setAttribute('aria-valuetext', `${Math.round(tile.clientHeight)} pixels`);
    }
    const scene = document.querySelector('#scene'); scene.classList.toggle('compact-stage', scene.clientHeight < 480);
  }
  toggle() {
    if (this.drag) this.end(null, true);
    this.editing = !this.editing; document.body.classList.toggle('editing-layout', this.editing);
    const button = document.querySelector('[data-action="edit-layout"]');
    button.setAttribute('aria-pressed', String(this.editing)); button.querySelector('span').textContent = this.editing ? 'Concluir layout' : 'Editar layout';
    document.querySelector('#layout-toolbar').hidden = !this.editing;
    this.onEdit(this.editing); this.apply();
  }
  reset() { this.onResizeStart(); this.layout = {}; this.apply(); this.onSave(); this.notify('Tamanhos dos cards restaurados.'); }
  start(event) {
    const handle = event.target.closest('.resize-handle');
    if (!handle || !this.editing || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const tile = handle.closest('.layout-tile'), box = tile.getBoundingClientRect(); this.onResizeStart();
    this.drag = { tile, handle, id: tile.dataset.panel, edge: handle.dataset.edge, x: event.clientX, y: event.clientY, width: box.width, height: box.height, before: this.snapshot(), boardWidth: tile.parentElement.clientWidth, gap: parseFloat(getComputedStyle(tile.parentElement).columnGap) || 0 };
    handle.setPointerCapture(event.pointerId); document.body.classList.add('resizing-layout');
  }
  move(event) {
    const d = this.drag; if (!d) return;
    const item = { ...this.layout[d.id] };
    if (d.edge.includes('e') && innerWidth > 600) item.columns = columnsForWidth(d.width + event.clientX - d.x, d.boardWidth, d.gap);
    if (d.edge.includes('s')) item.height = d.height + event.clientY - d.y;
    this.layout = cleanPanelLayout({ ...this.layout, [d.id]: item }); this.apply();
  }
  end(event, cancel = false) {
    if (!this.drag) return; const d = this.drag;
    if (cancel) this.layout = d.before;
    if (event && d.handle.hasPointerCapture(event.pointerId)) d.handle.releasePointerCapture(event.pointerId);
    this.drag = null; document.body.classList.remove('resizing-layout'); this.apply();
    if (!cancel) this.onSave();
  }
  key(event) {
    if (event.key === 'Escape' && this.drag) { event.preventDefault(); this.end(null, true); return; }
    const handle = event.target.closest('.resize-handle');
    if (!handle || !this.editing || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); this.onResizeStart();
    const tile = handle.closest('.layout-tile'), id = tile.dataset.panel, item = { ...this.layout[id] };
    if (handle.dataset.edge.includes('e') && ['ArrowLeft', 'ArrowRight'].includes(event.key) && innerWidth > 600) item.columns = (item.columns || this.defaults(tile)) + (event.key === 'ArrowRight' ? 1 : -1);
    if (handle.dataset.edge.includes('s') && ['ArrowUp', 'ArrowDown'].includes(event.key)) item.height = (item.height || tile.clientHeight) + (event.key === 'ArrowDown' ? 20 : -20);
    this.layout = cleanPanelLayout({ ...this.layout, [id]: item }); this.apply(); this.onSave();
  }
}
