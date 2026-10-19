import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanHook, applyHook, createObservation, hookConfig } from '../lib/codex-hooks.mjs';
import { characterBindings, extraObservedAgents } from '../public/live-observation.js';
const event = (kind, extra = {}) => cleanHook({ session_id: 'parent', hook_event_name: kind, ...extra });
const plan = steps => event('PostToolUse', { tool_name: 'update_plan', tool_input: { plan: steps } });

test('validating the current batch closes delivered delegation while roadmap stays queued', () => {
  const state = createObservation();
  applyHook(state, plan([{ id: 'backlog', step: 'Futura expressão', status: 'pending' }]));
  applyHook(state, event('SubagentStart', { agent_id: 'builder', agent_type: 'Construção' }));
  applyHook(state, plan([{ id: 'current', step: 'Corrigir iniciador', status: 'in_progress' }]));
  applyHook(state, event('SubagentStop', { agent_id: 'builder' }));
  assert.equal(state.sessions.parent.tasks.find(t => t.delegation).status, 'active');
  applyHook(state, plan([{ id: 'current', step: 'Corrigir iniciador', status: 'completed' }]));
  assert.equal(state.sessions.parent.tasks.find(t => t.delegation).status, 'done');
  assert.equal(state.sessions.parent.tasks.find(t => t.externalId === 'backlog').status, 'queued');
  assert.equal(state.sessions.parent.tasks.find(t => t.externalId === 'current').status, 'done');
});

test('explicit plan replacement splits a card without removing omitted tasks or other sessions', () => {
  const s = createObservation();
  applyHook(s, plan([{ step: 'Grupo', status: 'pending' }, { step: 'Roleta', status: 'completed' }, { step: 'Quartos', status: 'pending' }]));
  const rouletteId = s.sessions.parent.tasks.find(t => t.title === 'Roleta').id;
  applyHook(s, event('PostToolUse', { session_id: 'other', tool_name: 'update_plan', tool_input: { plan: [{ step: 'Grupo', status: 'pending' }] } }));
  const other = structuredClone(s.sessions.other);
  const replacement = () => event('PostToolUse', { tool_name: 'update_plan', tool_input: {
    plan: [{ step: 'Roleta', status: 'completed' }, { step: 'Dados', status: 'pending' }, { step: 'Lista', status: 'pending' }],
    superseded_steps: ['Grupo', 'Grupo', null, { secret: 'not metadata' }]
  } });
  const e = replacement();
  assert.deepEqual(e.superseded_steps, ['Grupo']);
  assert.deepEqual(cleanHook(e).superseded_steps, ['Grupo'], 'Metadata survives the hook and server sanitizers');
  applyHook(s, e);
  applyHook(s, replacement());
  assert.deepEqual(s.sessions.parent.tasks.map(t => [t.title, t.status]), [['Quartos', 'queued'], ['Roleta', 'done'], ['Dados', 'queued'], ['Lista', 'queued']]);
  assert.equal(s.sessions.parent.tasks.find(t => t.title === 'Roleta').id, rouletteId);
  assert.deepEqual(s.sessions.other, other);
});

test('subagents cannot replace principal plan cards and omission alone preserves the group', () => {
  const s = createObservation();
  applyHook(s, plan([{ step: 'Grupo', status: 'pending' }]));
  applyHook(s, plan([{ step: 'Dados', status: 'pending' }]));
  assert.ok(s.sessions.parent.tasks.some(t => t.title === 'Grupo'));
  applyHook(s, event('SubagentStart', { agent_id: 'child' }));
  applyHook(s, event('PostToolUse', { agent_id: 'child', tool_name: 'update_plan', tool_input: {
    plan: [{ step: 'Dados', status: 'pending' }], superseded_steps: ['Grupo', 'Delegação · Subagente']
  } }));
  assert.ok(s.sessions.parent.tasks.some(t => t.title === 'Grupo'));
  assert.ok(s.sessions.parent.tasks.some(t => t.delegation));
});
test('hooks allowlist metadata without forwarding commands or transcripts', () => {
  const e = event('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'secret' }, transcript_path: 'secret', last_assistant_message: 'secret' });
  assert.ok(!JSON.stringify(e).includes('secret'));
  assert.equal(cleanHook({ session_id: 'a', hook_event_name: 'unknown' }), null);
});
test('plans control the board; Stop and child delivery never imply completion', () => {
  const s = createObservation();
  applyHook(s, event('UserPromptSubmit', { prompt: 'Construir', turn_id: 't1' })); assert.equal(s.sessions.parent.tasks[0].status, 'queued');
  applyHook(s, plan([{ step: 'Construir', status: 'in_progress' }, { step: 'Revisar', status: 'pending' }]));
  applyHook(s, event('SubagentStart', { agent_id: 'child', agent_type: 'reviewer' }));
  applyHook(s, plan([{ step: 'Construir', status: 'completed' }])); assert.equal(s.sessions.parent.tasks.find(t => t.title === 'Construir').status, 'active');
  applyHook(s, event('SubagentStop', { agent_id: 'child' }));
  applyHook(s, event('Stop')); assert.equal(s.sessions.parent.tasks.find(t => t.title === 'Construir').status, 'active');
  applyHook(s, plan([{ step: 'Construir', status: 'completed' }, { step: 'Revisar', status: 'completed' }])); assert.ok(s.sessions.parent.tasks.every(t => t.status === 'done'));
});
test('sessions start empty, duplicates are ignored, child tools attach to parent', () => {
  const s = createObservation(); const e = event('SessionStart'); applyHook(s, e); assert.equal(applyHook(s, e), null);
  applyHook(s, event('SubagentStart', { agent_id: 'child' }));
  const child = applyHook(s, event('PreToolUse', { session_id: 'child', tool_name: 'apply_patch' })); assert.equal(child.parentId, 'codex:parent:main'); assert.equal(child.status, 'writing');
  applyHook(s, event('SessionStart', { session_id: 'new' })); assert.deepEqual(s.sessions.new.tasks, []);
});
test('characters retain identity; provider and manual bindings are respected', () => {
  const chars = [{ id: 'atlas', provider: 'codex', binding: '' }, { id: 'nova', provider: 'claude', binding: '' }, { id: 'orbit', provider: 'codex', binding: '' }];
  const observed = [{ agentId: 'main', provider: 'codex', parentId: null }, { agentId: 'child', provider: 'codex', parentId: 'main' }];
  const bindings = characterBindings(chars, observed); assert.equal(bindings.get('atlas').agentId, 'main'); assert.equal(bindings.get('orbit').agentId, 'child'); assert.ok(!bindings.has('nova'));
  chars[0].binding = 'elsewhere'; assert.ok(!characterBindings(chars, observed).has('atlas'));
});
test('generated hooks use the actual executable and return no approval decisions', () => {
  const c = hookConfig('C:\\Node\\node.exe', 'C:\\Nexus\\scripts\\codex-hook.mjs');
  assert.match(c.hooks.SubagentStart[0].hooks[0].command, /C:\/Node\/node.exe/);
  assert.ok(c.hooks.UserPromptSubmit && c.hooks.Stop);
});

test('restored offline agents do not create extra characters after rebinding', () => {
  const chars = [{ id: 'worker', provider: 'codex', binding: 'new-child' }];
  const observed = [
    { agentId: 'nova', provider: 'codex', status: 'offline' },
    { agentId: 'orbit', provider: 'codex', status: 'offline' },
    { agentId: 'new-child', provider: 'codex', status: 'done' },
    { agentId: 'active-extra', provider: 'codex', status: 'reading' },
    { agentId: 'delivering', provider: 'codex', status: 'done' }
  ];
  const bindings = characterBindings(chars, observed);
  assert.equal(bindings.get('worker').agentId, 'new-child');
  assert.deepEqual(extraObservedAgents(observed, bindings).map(a => a.agentId), ['active-extra', 'delivering']);
  assert.equal(characterBindings([{ ...chars[0], binding: 'nova' }], observed).get('worker').status, 'offline');
});

test('automatic bindings skip offline history and prefer active children', () => {
  const chars = [{ id: 'worker', provider: 'codex', binding: '' }];
  const observed = [
    { agentId: 'old', provider: 'codex', parentId: 'main', status: 'offline' },
    { agentId: 'delivered', provider: 'codex', parentId: 'main', status: 'done', timestamp: '2026-10-08T12:00:00Z' },
    { agentId: 'active', provider: 'codex', parentId: 'main', status: 'reading', timestamp: '2026-10-08T11:00:00Z' }
  ];
  assert.equal(characterBindings(chars, observed).get('worker').agentId, 'active');
  assert.equal(characterBindings(chars, [observed[0]]).size, 0);
});
test('a late child Stop preserves delivery and allows explicit principal validation', () => {
  const s = createObservation();
  applyHook(s, event('SubagentStart', { agent_id: 'child' }));
  applyHook(s, plan([{ step: 'Validar entrega', status: 'in_progress' }]));
  applyHook(s, event('SubagentStop', { agent_id: 'child' }));
  const stopped = applyHook(s, event('Stop', { session_id: 'child' }));
  assert.equal(stopped.status, 'done'); assert.equal(s.sessions.parent.children.child.status, 'done');
  assert.equal(s.sessions.parent.tasks.find(t => t.delegation).status, 'active', 'Delivery still requires validation');
  applyHook(s, plan([{ step: 'Validar entrega', status: 'completed' }]));
  assert.ok(s.sessions.parent.tasks.every(t => t.status === 'done'));
});
test('an undelivered child remains pending; actual new work reopens a delivered child', () => {
  const s = createObservation();
  applyHook(s, event('SubagentStart', { agent_id: 'child' }));
  applyHook(s, event('Stop', { session_id: 'child' }));
  applyHook(s, plan([{ step: 'Validar entrega', status: 'completed' }]));
  assert.equal(s.sessions.parent.tasks.find(t => t.title === 'Validar entrega').status, 'active');
  applyHook(s, event('SubagentStop', { agent_id: 'child' }));
  applyHook(s, event('PreToolUse', { session_id: 'child', tool_name: 'apply_patch' }));
  assert.equal(s.sessions.parent.children.child.status, 'writing');
  applyHook(s, plan([{ step: 'Validar entrega', status: 'completed' }]));
  assert.equal(s.sessions.parent.tasks.find(t => t.title === 'Validar entrega').status, 'active');
});
