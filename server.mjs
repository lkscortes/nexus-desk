import http from 'node:http';
import { resolveDataDir } from './lib/paths.mjs';
import { readFile, writeFile, mkdir, rename, stat, readdir, unlink } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { defaultConfig, validateConfig, createRuntime, applyEvent } from './lib/model.mjs';
import { fromClaude, fromCodex } from './lib/adapters.mjs';
import { createObservation, restoreObservation, restoreObservedAgents, cleanHook, applyHook, hookConfig } from './lib/codex-hooks.mjs';
import { cleanClaudeHook, applyClaudeHook, claudeHookConfig } from './lib/claude-observation.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
async function bodyOf(request) {
  let size = 0, chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 8_000_000) throw Object.assign(new Error('Arquivo muito grande.'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}

export async function createDeskServer({ port = 4318, dataDir = resolveDataDir(), persist = true } = {}) {
  let config = defaultConfig();
  if (persist) {
    await mkdir(dataDir, { recursive: true });
    try { config = validateConfig(JSON.parse(await readFile(resolve(dataDir, 'config.json'), 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') console.warn('Configuração anterior inválida; usando padrão.'); }
  }
  const token = randomBytes(32).toString('hex');
  const runtime = createRuntime();
  runtime.observation = createObservation();
  if (persist) {
    try { const saved = JSON.parse(await readFile(resolve(dataDir, 'observation.json'), 'utf8')); if (saved.version === 1) { runtime.observation = restoreObservation(saved.observation); runtime.agents = restoreObservedAgents(saved.agents, runtime.observation); } } catch (e) { if (e.code !== 'ENOENT') console.warn('Nexus: histórico inválido; não foi carregado.'); }
  }
  const clients = new Set();
  let origin, writeQueue = Promise.resolve();
  const broadcast = (type, payload) => { for (const response of clients) response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); };
  const snapshot = () => ({ config, runtime });
  let hookQueue = Promise.resolve();
  const receiveHook = (raw, provider = raw?.provider === 'claude' ? 'claude' : 'codex') => {
    const run = hookQueue.catch(() => {}).then(async () => {
      const e = provider === 'claude' ? cleanClaudeHook(raw) : cleanHook(raw); if (!e) return false;
      const next = structuredClone(runtime);
      const event = provider === 'claude' ? applyClaudeHook(next.observation, e) : applyHook(next.observation, e); if (!event) return true;
      applyEvent(next, event);
      if (persist) {
        await writeFile(resolve(dataDir, 'observation.tmp'), JSON.stringify({ version: 1, observation: next.observation, agents: next.agents }));
        await rename(resolve(dataDir, 'observation.tmp'), resolve(dataDir, 'observation.json'));
      }
      Object.assign(runtime, next);
      broadcast('runtime', runtime); return true;
    });
    hookQueue = run; return run;
  };
  const persistConfig = next => {
    if (!persist) return Promise.resolve();
    const contents = JSON.stringify(next, null, 2);
    writeQueue = writeQueue.catch(() => {}).then(async () => { await writeFile(resolve(dataDir, 'config.tmp'), contents); await rename(resolve(dataDir, 'config.tmp'), resolve(dataDir, 'config.json')); });
    return writeQueue;
  };
  const validToken = request => {
    const value = (request.headers.authorization || '').replace(/^Bearer /, '');
    return value.length === token.length && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  };
  const server = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host) return json(response, 403, { error: 'Host inválido.' });
      if ((request.headers.origin && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') return json(response, 403, { error: 'Origem não permitida.' });
      const url = new URL(request.url, origin);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      if (request.method === 'GET' && url.pathname === '/api/session') return json(response, 200, { token });
      if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, snapshot());
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { ok: true, name: 'nexus-desk', integrationVersion: 2, cardProtocolVersion: 1, reconnectVersion: 1, delegationValidationVersion: 1, providers: runtime.providers });
      if (request.method === 'GET' && url.pathname === '/api/stream') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
        clients.add(response); request.on('close', () => clients.delete(response)); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/integrations') {
        const scriptPath = resolve(root, 'scripts', 'claude-hook.mjs');
        // Generated config is shown for review; no ~/.claude file is written.
        const { hooks } = claudeHookConfig(process.execPath, scriptPath);
        const codexCommand = `codex exec --json --skip-git-repo-check --sandbox read-only "Descreva a estrutura deste projeto" | ${process.platform === 'win32' ? '& ' : ''}"${process.execPath}" "${resolve(root, 'scripts', 'codex-stream.mjs')}"`;
        return json(response, 200, { claude: { hooks }, codex: codexCommand, codexHooks: hookConfig(process.execPath, resolve(root, 'scripts', 'codex-hook.mjs')), endpoint: `${origin}/api/events` });
      }
      if (url.pathname.startsWith('/api/') && request.method !== 'GET') {
        if (!validToken(request)) return json(response, 401, { error: 'Token local necessário.' });
        const input = await bodyOf(request);
        if (request.method === 'POST' && url.pathname === '/api/hooks/codex' && input.hook_event_name) return json(response, 202, { received: await receiveHook(input, 'codex') });
        if (request.method === 'POST' && url.pathname === '/api/hooks/claude') return json(response, 202, { received: await receiveHook(input, 'claude') });
        if (request.method === 'PUT' && url.pathname === '/api/config') {
          const next = validateConfig(input); await persistConfig(next); config = next; broadcast('config', config); return json(response, 200, { config });
        }
        if (request.method === 'POST' && ['/api/events', '/api/hooks/claude', '/api/hooks/codex'].includes(url.pathname)) {
          const event = url.pathname.endsWith('/claude') ? fromClaude(input) : url.pathname.endsWith('/codex') ? fromCodex(input, { threadId: input.threadId }) : input;
          if (!event) return json(response, 202, { ignored: true });
          const applied = applyEvent(runtime, event); if (applied) broadcast('runtime', runtime);
          return json(response, 202, { received: !!applied });
        }
        return json(response, 404, { error: 'Rota não encontrada.' });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Método não permitido.' });
      const publicDir = resolve(root, 'public');
      const path = resolve(publicDir, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(publicDir + sep)) return json(response, 403, { error: 'Caminho inválido.' });
      const fileStat = await stat(path); if (!fileStat.isFile()) return json(response, 404, { error: 'Arquivo não encontrado.' });
      const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(path));
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      json(response, error.code === 'ENOENT' ? 404 : error.status || 400, { error: error.code === 'ENOENT' ? 'Arquivo não encontrado.' : error.message });
    }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  origin = `http://127.0.0.1:${server.address().port}`;
  if (persist) await writeFile(resolve(dataDir, 'bridge.json'), JSON.stringify({ origin, token }), { mode: 0o600 });
  let draining = false;
  const drainInbox = async () => {
    if (!persist || draining) return;
    draining = true;
    try {
      const inbox = resolve(dataDir, 'inbox');
      const files = await readdir(inbox);
      const pending = [];
      for (const name of files.filter(n => /^[a-zA-Z0-9-]+\.json$/.test(n)).slice(0, 1000)) {
        try { pending.push({ path: resolve(inbox, name), event: JSON.parse(await readFile(resolve(inbox, name), 'utf8')) }); } catch {}
      }
      pending.sort((a, b) => String(a.event.timestamp).localeCompare(String(b.event.timestamp)));
      for (const item of pending) { if (await receiveHook(item.event)) await unlink(item.path).catch(() => {}); }
    } catch (e) { if (e.code !== 'ENOENT') console.warn('Nexus: não foi possível importar a fila de hooks.'); }
    finally { draining = false; }
  };
  await drainInbox();
  const inboxTimer = setInterval(drainInbox, 2000); inboxTimer.unref();
  const timer = setInterval(() => { for (const response of clients) response.write(': heartbeat\n\n'); }, 15000); timer.unref();
  return { server, origin, token, runtime, getConfig: () => config, close: async () => { clearInterval(timer); clearInterval(inboxTimer); await hookQueue.catch(() => {}); for (const response of clients) response.end(); await new Promise(done => server.close(done)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const desk = await createDeskServer({ port: Number(process.env.NEXUS_PORT || 4318) });
  console.log(`Nexus Desk · Local: ${desk.origin}`);
  console.log('Demonstração pronta. Conectores disponíveis na aba Conexões. Ctrl+C encerra.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await desk.close(); process.exit(0); });
}
