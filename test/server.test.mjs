import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createDeskServer } from '../server.mjs';

test('local server receives both providers and protects mutations', async () => {
  const desk = await createDeskServer({ port: 0, persist: false });
  const post = (route, body, token = desk.token, extraHeaders = {}) => fetch(desk.origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extraHeaders }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(desk.origin)).status, 200);
    assert.equal((await post('/api/events', { provider: 'codex', agentId: 'a', status: 'idle' }, 'wrong')).status, 401);
    assert.equal((await post('/api/events', { provider: 'codex', agentId: 'a', status: 'idle' }, desk.token, { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await post('/api/events', { provider: 'codex', agentId: 'a', status: 'invented' })).status, 400);
    assert.equal((await post('/api/hooks/claude', { session_id: 'claude-1', hook_event_name: 'PreToolUse', tool_name: 'Write' })).status, 202);
    assert.equal((await post('/api/hooks/codex', { type: 'turn.started', threadId: 'codex-1' })).status, 202);
    const state = await (await fetch(desk.origin + '/api/state')).json();
    assert.equal(state.runtime.totalEvents, 2); assert.equal(state.runtime.agents['claude:claude-1:main'].status, 'writing');
    assert.equal(state.runtime.agents['codex:codex-1'].status, 'thinking');
    const config = await (await fetch(desk.origin + '/api/integrations')).json(); assert.ok(config.claude.hooks.SubagentStart); assert.match(config.codex, /codex exec --json/);
  } finally { await desk.close(); }
});
test('SSE reports real events and closes cleanly', async () => {
  const desk = await createDeskServer({ port: 0, persist: false });
  const abort = new AbortController();
  try {
    const response = await fetch(desk.origin + '/api/stream', { signal: abort.signal });
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const reader = response.body.getReader(); const first = await reader.read(); assert.match(new TextDecoder().decode(first.value), /event: snapshot/);
    await fetch(desk.origin + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${desk.token}` }, body: JSON.stringify({ provider: 'custom', agentId: 'custom:1', name: 'Integration test', status: 'done', message: 'Finished' }) });
    const next = await reader.read(); assert.match(new TextDecoder().decode(next.value), /event: runtime/); assert.match(new TextDecoder().decode(next.value), /Finished/);
    await reader.cancel();
  } finally { abort.abort(); await desk.close(); }
});
test('team customizations survive restarting the local bridge', async () => {
  const testRoot = fileURLToPath(new URL('../.local/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const dir = await mkdtemp(join(testRoot, 'nexus-desk-test-'));
  let desk = await createDeskServer({ port: 0, dataDir: dir });
  try {
    const config = desk.getConfig(); config.title = 'MY UNIVERSE'; config.agents = config.agents.slice(0, 1);
    const response = await fetch(desk.origin + '/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${desk.token}` }, body: JSON.stringify(config) }); assert.equal(response.status, 200);
    const saved = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')); assert.equal(saved.title, 'MY UNIVERSE');
    await desk.close(); desk = await createDeskServer({ port: 0, dataDir: dir }); assert.equal(desk.getConfig().agents.length, 1); assert.equal(desk.getConfig().title, 'MY UNIVERSE');
  } finally {
    await desk.close();
    assert.ok(dir.startsWith(join(testRoot, 'nexus-desk-test-')), 'Cleanup must stay inside this test’s temporary directory.');
    await rm(dir, { recursive: true, force: true });
  }
});
