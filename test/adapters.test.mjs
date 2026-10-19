import test from 'node:test';
import assert from 'node:assert/strict';
import { fromClaude, fromCodex } from '../lib/adapters.mjs';
import { createRuntime, applyEvent, defaultConfig, validateConfig } from '../lib/model.mjs';

test('Claude tool events retain identity without forwarding source secrets', () => {
  const event = fromClaude({ session_id: 'session-a', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\private\\config.ts', secret: 'do-not-forward' }, prompt: 'private prompt', tool_response: 'private output' });
  assert.equal(event.agentId, 'claude:session-a:main'); assert.equal(event.status, 'reading');
  assert.match(event.message, /config\.ts/); assert.doesNotMatch(JSON.stringify(event), /private|secret|do-not-forward/);
});
test('Claude child agents remain distinct and point to their parent', () => {
  const event = fromClaude({ session_id: 's', agent_id: 'child-1', agent_type: 'Explore', hook_event_name: 'SubagentStart' });
  assert.equal(event.agentId, 'claude:s:child-1'); assert.equal(event.parentId, 'claude:s:main'); assert.equal(event.name, 'Explore');
  assert.equal(fromClaude({ session_id: 's', agent_id: 'child-1', hook_event_name: 'SubagentStop' }).status, 'done');
});
test('Claude approvals and failures are observational states', () => {
  assert.equal(fromClaude({ session_id: 's', hook_event_name: 'PermissionRequest' }).status, 'waiting');
  assert.equal(fromClaude({ session_id: 's', hook_event_name: 'PostToolUseFailure' }).status, 'error');
  assert.equal(fromClaude({ session_id: 's', hook_event_name: 'UnknownFutureEvent' }), null);
});
test('Codex CLI JSONL events share one identity across a full turn', () => {
  const context = { threadId: 'thread-1' };
  const events = [
    fromCodex({ type: 'thread.started', thread_id: 'thread-1' }),
    fromCodex({ type: 'turn.started' }, context),
    fromCodex({ type: 'item.started', item: { type: 'command_execution', command: 'SECRET_COMMAND' } }, context),
    fromCodex({ type: 'turn.completed', usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 3 } }, context)
  ];
  assert.deepEqual(events.map(e => e.status), ['idle', 'thinking', 'running', 'done']);
  assert.equal(new Set(events.map(e => e.agentId)).size, 1); assert.equal(events[3].tokens, 23);
  assert.doesNotMatch(JSON.stringify(events), /SECRET_COMMAND/);
});
test('Codex App Server notifications recognize writes, approvals and interruptions', () => {
  assert.equal(fromCodex({ method: 'item/started', params: { threadId: 't', item: { type: 'fileChange' } } }).status, 'writing');
  assert.equal(fromCodex({ method: 'item/fileChange/requestApproval', params: { threadId: 't' } }).status, 'waiting');
  assert.equal(fromCodex({ method: 'turn/completed', params: { threadId: 't', turn: { status: 'interrupted' } } }).status, 'idle');
  assert.equal(fromCodex({ method: 'turn/completed', params: { threadId: 't', turn: { status: 'failed' } } }).status, 'error');
});
test('runtime isolates providers and de-duplicates retries by event ID', () => {
  const runtime = createRuntime();
  applyEvent(runtime, { provider: 'codex', agentId: 'codex:a', status: 'reading', eventId: 'retry-1' });
  assert.equal(applyEvent(runtime, { provider: 'codex', agentId: 'codex:a', status: 'reading', eventId: 'retry-1' }), null);
  applyEvent(runtime, { provider: 'claude', agentId: 'claude:a', status: 'waiting', eventId: 'retry-1' });
  assert.equal(runtime.totalEvents, 2); assert.equal(Object.keys(runtime.agents).length, 2); assert.equal(runtime.agents['claude:a'].status, 'waiting');
});
test('config allows empty teams, bounds positions and rejects unsafe assets', () => {
  const config = defaultConfig(); config.agents[0].x = 900; config.agents[0].color = 'red;position:fixed';
  const clean = validateConfig(config); assert.equal(clean.agents[0].x, 88); assert.match(clean.agents[0].color, /^#[a-f0-9]{6}$/);
  assert.equal(validateConfig({ ...config, agents: [] }).agents.length, 0);
  config.agents[0].sprite = 'javascript:alert(1)'; assert.throws(() => validateConfig(config));
});
test('config supports per-session visual identities beyond the old template count', () => {
  const agents = Array.from({ length: 16 }, (_, i) => ({ id: `avatar-${i}`, name: `Avatar ${i}`, role: 'Coordenação', provider: 'claude', binding: `claude:session-${i}:main`, sessionOnly: i > 2 }));
  const clean = validateConfig({ ...defaultConfig(), agents });
  assert.equal(clean.agents.length, 16);
  assert.equal(clean.agents[15].sessionOnly, true);
  assert.equal(clean.agents[0].sessionOnly, false);
  assert.throws(() => validateConfig({ ...defaultConfig(), agents: Array.from({ length: 65 }, (_, i) => ({ id: `a${i}` })) }), /64/);
});
