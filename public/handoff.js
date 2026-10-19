import { characterHue } from './character-skins.js';
export class HandoffController {
  constructor({ scene, hub, layer, getAgents, canMove, onPhase }) {
    Object.assign(this, { scene, hub, layer, getAgents, canMove, onPhase });
    this.pending = []; this.paused = false; this.active = null; this.packet = null; this.generation = 0;
    let size = `${scene.clientWidth}:${scene.clientHeight}`, resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const next = `${scene.clientWidth}:${scene.clientHeight}`;
        if (next !== size) { size = next; if (this.active) this.cancel(false); }
      }, 300);
    });
  }
  get busy() { return !!this.active || this.pending.length > 0; }
  enqueue(job) { if (this.pending.length < 24) { this.pending.push(job); this.drain(); } }
  cancel(clearPacket = true) {
    this.generation++; this.pending = [];
    this.active?.node?.remove(); this.active = null;
    if (clearPacket) this.packet = null;
    this.sync();
  }
  setPaused(value) {
    this.paused = value;
    this.layer.classList.toggle('paused', value);
    if (!value) this.drain();
  }
  sync() {
    if (this.active && (!this.getAgents().some(a => a.id === this.active.job.agentId) || !this.canMove())) { this.cancel(false); return; }
    for (const station of this.scene.querySelectorAll('.station')) {
      const away = station.dataset.id === this.active?.job.agentId;
      station.classList.toggle('is-away', away);
      station.dataset.journey = away ? (this.active.job.kind === 'deliver' ? 'ENTREGANDO TAREFA' : 'BUSCANDO TAREFA') : '';
    }
    this.hub.classList.toggle('has-packet', !!this.packet);
    this.hub.classList.toggle('in-transfer', !!this.active);
    this.hub.dataset.phase = this.active?.phase || 'idle';
    this.hub.style.setProperty('--parcel-color', this.packet?.color || '#68e8f9');
    const message = this.hub.querySelector('#hub-message');
    message.textContent = this.active ? this.active.message : this.packet ? 'Uma ideia pronta para o próximo agente' : 'O ponto de encontro das ideias';
    this.hub.querySelector('#hub-packet').title = this.packet?.title || '';
  }
  phase(name, message) {
    const job = this.active.job;
    this.active.phase = name; this.active.message = message; this.sync(); this.onPhase(job, name);
  }
  animate(node, frames, duration, generation) {
    // A local frame clock also preserves a pause during browser screenshots.
    const points = frames[0].transform ? frames.map(f => f.transform.match(/translate\(([-\d.]+)px,([-\d.]+)px\) scale\(([-\d.]+)\)/).slice(1).map(Number)) : null;
    return new Promise((resolve, reject) => {
      let elapsed = 0, previous;
      const frame = now => {
        if (generation !== this.generation) { reject(new DOMException('Transferência cancelada', 'AbortError')); return; }
        if (previous !== undefined && !this.paused) elapsed += Math.min(64, now - previous);
        previous = now;
        const progress = Math.min(1, elapsed / duration), eased = .5 - Math.cos(progress * Math.PI) / 2;
        if (points) {
          const index = Math.min(points.length - 2, Math.floor(eased * (points.length - 1)));
          const t = eased * (points.length - 1) - index;
          const values = points[index].map((v, i) => v + (points[index + 1][i] - v) * t);
          node.style.transform = `translate(${values[0]}px,${values[1]}px) scale(${values[2]})`;
        }
        if (progress === 1) resolve(); else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }
  async drain() {
    if (this.active || this.paused || !this.pending.length) return;
    const job = this.pending.shift(), agent = this.getAgents().find(a => a.id === job.agentId);
    if (!agent) { this.drain(); return; }
    const generation = this.generation;
    try {
      if (!this.canMove()) {
        this.packet = job.kind === 'deliver' ? { title: job.title, color: agent.color } : null;
        this.sync(); this.onPhase(job, 'arrived'); this.onPhase(job, 'home'); return;
      }
      const station = [...this.scene.querySelectorAll('.station')].find(s => s.dataset.id === agent.id);
      if (!station) return;
      const image = station.querySelector('.mascot'), wrapper = station.querySelector('.mascot-wrap');
      const bat = station.classList.contains('bat-sprite');
      // Local layout coordinates stay stable when clicking the footer scrolls the page.
      const home = { x: station.offsetLeft, y: station.offsetTop - station.offsetHeight * .6 + wrapper.offsetHeight, scale: 1 };
      const table = this.hub.querySelector('.hub-desk');
      const dock = { x: this.scene.clientWidth / 2 + (home.x < this.scene.clientWidth / 2 ? -.34 : .34) * table.clientWidth, y: this.hub.offsetTop - this.hub.offsetHeight / 2 + table.clientHeight * .65, scale: .79 };
      const node = document.createElement('button'); node.className = 'courier'; node.dataset.action = 'select-agent'; node.dataset.id = agent.id;
      node.setAttribute('aria-label', `${agent.name}: ${job.kind === 'deliver' ? 'entregando' : 'buscando'} tarefa`);
      node.style.setProperty('--sprite-size', `${wrapper.offsetWidth}px`); node.style.setProperty('--sprite-height', `${wrapper.offsetHeight}px`); node.style.setProperty('--hue', characterHue(agent)); node.style.setProperty('--agent-color', agent.color);
      const shadow = document.createElement('span'); shadow.className = 'courier-shadow'; node.append(shadow);
      const body = document.createElement('span'); body.className = 'courier-body';
      const clone = bat ? wrapper.querySelector('.bat-mascot').cloneNode(true) : image.cloneNode(); clone.classList.add('courier-image'); body.append(clone);
      node.classList.toggle('bat-courier', bat);
      const parcel = document.createElement('span'); parcel.className = 'courier-parcel'; parcel.textContent = '≡'; parcel.title = job.title; body.append(parcel); node.append(body);
      node.classList.toggle('carrying', job.kind === 'deliver'); this.layer.append(node);
      this.active = { job, node, phase: 'outbound', message: '' };
      const transform = p => `translate(${p.x}px,${p.y}px) scale(${p.scale})`;
      const move = async (from, to) => {
        node.classList.add('hopping');
        const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 12, scale: (from.scale + to.scale) / 2 };
        await this.animate(node, [{ transform: transform(from) }, { transform: transform(middle), offset: .5 }, { transform: transform(to) }], Math.min(2300, 1250 + Math.hypot(to.x - from.x, to.y - from.y) * 2.4), generation);
        node.style.transform = transform(to); node.classList.remove('hopping');
      };
      const wait = ms => this.animate(body, [{ opacity: 1 }, { opacity: 1 }], ms, generation);
      node.style.transform = transform(home);
      this.phase('outbound', `${agent.name} ${job.kind === 'deliver' ? 'trazendo uma ideia' : 'indo buscar uma tarefa'}`);
      await move(home, dock);
      this.phase('at-table', `${agent.name} na mesa central`); await wait(450);
      this.packet = job.kind === 'deliver' ? { title: job.title, color: agent.color } : null;
      node.classList.toggle('carrying', job.kind === 'pickup');
      this.phase('arrived', `${agent.name} ${job.kind === 'deliver' ? 'deixou a tarefa na mesa' : 'pegou a próxima tarefa'}`); await wait(650);
      this.phase('returning', `${agent.name} voltando à sua bancada`); await move(dock, home);
      this.phase('home', `${agent.name} chegou à bancada`);
    } catch (error) { if (error.name !== 'AbortError') console.error('Transferência visual:', error); }
    finally {
      if (generation === this.generation) { this.active?.node?.remove(); this.active = null; this.sync(); }
      this.drain();
    }
  }
}
