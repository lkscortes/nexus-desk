import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createDeskServer } from '../server.mjs';
import { createNexusTools } from '../lib/nexus-mcp.mjs';

const root = fileURLToPath(new URL('../.local/', import.meta.url));
const temp = async () => { await mkdir(root, { recursive: true }); return mkdtemp(join(root, 'mcp-test-')); };
const script = fileURLToPath(new URL('../scripts/nexus-mcp.mjs', import.meta.url));
const step = status => [{ id: 'analysis', step: 'Análise real', status }];

test('MCP registers isolated conversations, preserves IDs and waits for real child validation', async () => {
  const dir = await temp(); const desk = await createDeskServer({ port: 0, dataDir: dir }); const call = createNexusTools({ dataDir: dir });
  try {
    assert.equal((await call('register_conversation', { session_id: 'a', title: 'Projeto A' })).confirmed, true);
    await call('publish_plan', { session_id: 'a', plan: step('pending') });
    await call('register_conversation', { session_id: 'b', title: 'Projeto B' });
    await call('publish_plan', { session_id: 'b', plan: step('pending') });
    await call('publish_plan', { session_id: 'a', plan: step('in_progress') });
    assert.equal((await call('read_board', { session_id: 'a' })).tasks[0].status, 'active');
    await call('agent_event', { session_id: 'a', event: 'SubagentStart', agent_id: 'real-child', role: 'Validação' });
    assert.equal((await call('agent_event', { session_id: 'a', event: 'SubagentStart', agent_id: 'real-child', role: 'Validação' })).already_reported, true);
    assert.equal((await call('read_board', { session_id: 'a' })).tasks.filter(t => t.id.startsWith('delegate:')).length, 1);
    await call('publish_plan', { session_id: 'a', plan: step('completed') });
    assert.equal((await call('read_board', { session_id: 'a' })).tasks[0].status, 'active');
    await call('agent_event', { session_id: 'a', event: 'SubagentStop', agent_id: 'real-child' });
    await call('publish_plan', { session_id: 'a', plan: [{ ...step('completed')[0], step: 'Título corrigido' }] });
    await call('agent_event', { session_id: 'a', event: 'Stop' });
    const board = await call('read_board', { session_id: 'a' });
    assert.equal(board.tasks[0].id, 'analysis'); assert.equal(board.tasks[0].status, 'done');
    assert.equal((await call('read_board', { session_id: 'b' })).tasks[0].status, 'queued');
    assert.equal((await readdir(join(dir, 'inbox'))).length, 0);
    await assert.rejects(call('publish_plan', { session_id: 'a', plan: [step('pending')[0], step('pending')[0]] }), /inválido/);
    await assert.rejects(call('agent_event', { session_id: 'a', event: 'SubagentStart' }), /real/);
  } finally { await desk.close(); await rm(dir, { recursive: true, force: true }); }
});

test('MCP queues offline events and running server drains without restart', async () => {
  const dir = await temp(); const desk = await createDeskServer({ port: 0, dataDir: dir }); const call = createNexusTools({ dataDir: dir });
  try {
    const bridgePath = join(dir, 'bridge.json'); const bridge = await readFile(bridgePath, 'utf8');
    await writeFile(bridgePath, JSON.stringify({ origin: 'http://127.0.0.1:1', token: 'unavailable' }));
    assert.equal((await call('publish_plan', { session_id: 'offline', plan: step('in_progress') })).queued, true);
    await writeFile(bridgePath, bridge);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !(await call('read_board', { session_id: 'offline' })).tasks) await new Promise(r => setTimeout(r, 100));
    assert.equal((await call('read_board', { session_id: 'offline' })).tasks[0].status, 'active');
    assert.equal((await readdir(join(dir, 'inbox'))).length, 0);
  } finally { await desk.close(); await rm(dir, { recursive: true, force: true }); }
});

test('stdio MCP handshake, discovery, calls and errors use only JSON on stdout', async () => {
  const dir = await temp(); const desk = await createDeskServer({ port: 0, dataDir: dir });
  const child = spawn(process.execPath, [script], { env: { ...process.env, NEXUS_DATA_DIR: dir }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const lines = createInterface({ input: child.stdout }); const waiting = new Map(); let serial = 0;
  lines.on('line', line => { const value = JSON.parse(line); const pending = waiting.get(value.id); if (pending) { clearTimeout(pending.timer); pending.resolve(value); waiting.delete(value.id); } });
  const rpc = (method, params) => new Promise((resolve, reject) => { const id = ++serial; waiting.set(id, { resolve, timer: setTimeout(() => reject(new Error('MCP timeout')), 5000) }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  try {
    assert.equal((await rpc('initialize', { protocolVersion: '2025-03-26' })).result.serverInfo.name, 'nexus-desk');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    assert.equal((await rpc('tools/list')).result.tools.length, 4);
    const res = await rpc('tools/call', { name: 'register_conversation', arguments: { session_id: 'protocol', title: 'Teste isolado' } });
    assert.equal(JSON.parse(res.result.content[0].text).confirmed, true);
    assert.equal((await rpc('tools/call', { name: 'read_board', arguments: {} })).result.isError, true);
    assert.equal((await rpc('missing')).error.code, -32601);
  } finally { child.stdin.end(); child.kill(); lines.close(); await desk.close(); await rm(dir, { recursive: true, force: true }); }
});

test('global installer preserves other integrations and user instructions and is idempotent', async () => {
  const dir = await temp();
  const run = () => new Promise((resolve, reject) => { const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/install-nexus-mcp.mjs', import.meta.url)), '--home', dir], { stdio: 'pipe', windowsHide: true }); let stderr = ''; child.stderr.on('data', c => stderr += c); child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr))); child.on('error', reject); });
  try {
    await writeFile(join(dir, 'config.toml'), '[mcp_servers.other]\ncommand = "other"\n\n[features]\nhooks = true\n');
    await writeFile(join(dir, 'AGENTS.md'), '# Minhas instruções\nPreserve meu trabalho.\n');
    await run(); const config = await readFile(join(dir, 'config.toml'), 'utf8'), agents = await readFile(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(config, /command = "other"/); assert.match(config, /hooks = true/); assert.match(agents, /Preserve meu trabalho/);
    await run(); assert.equal(await readFile(join(dir, 'config.toml'), 'utf8'), config); assert.equal(await readFile(join(dir, 'AGENTS.md'), 'utf8'), agents);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
