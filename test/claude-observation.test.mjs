import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cleanClaudeHook, applyClaudeHook, claudeHookEvents } from '../lib/claude-observation.mjs';
import { applyHook, cleanHook, createObservation } from '../lib/codex-hooks.mjs';
import { viewedSessions } from '../public/live-observation.js';
import { createDeskServer } from '../server.mjs';
import { installClaudeProject } from '../scripts/install-claude-project.mjs';

const raw = (kind, extra = {}) => ({ session_id: 'TEST-claude-initial', hook_event_name: kind, ...extra });
const event = (kind, extra = {}) => cleanClaudeHook(raw(kind, extra));
const todos = statuses => event('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: statuses.map((status, i) => ({ content: `Etapa ${i + 1}`, status, activeForm: 'private' })) } });
const temp = () => mkdtemp(resolve(process.cwd(), 'claude-test-'));

test('Claude sanitizes before transport and allows only documented metadata', () => {
  const e = event('UserPromptSubmit', { prompt: 'PRIVATE', transcript_path: 'PRIVATE', last_assistant_message: 'PRIVATE' });
  assert.equal(e.title, 'Conversa Claude Code');
  assert.ok(!JSON.stringify(e).includes('PRIVATE'));
  assert.ok(!JSON.stringify(event('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'PRIVATE' }, tool_response: 'PRIVATE' })).includes('PRIVATE'));
  assert.deepEqual(cleanClaudeHook(todos(['pending'])).todos, [{ content: 'Etapa 1', status: 'pending' }]);
  assert.equal(event('Interrupt'), null);
  assert.equal(event('SessionStart', { session_id: '__proto__' }), null);
});

test('Claude TodoWrite controls the board; Stop and child delivery require principal validation', () => {
  const state = createObservation();
  applyHook(state, cleanHook({ session_id: 'TEST-claude-initial', hook_event_name: 'SessionStart' }));
  applyClaudeHook(state, event('SessionStart'));
  applyClaudeHook(state, todos(['in_progress', 'pending']));
  const s = state.sessions['claude:TEST-claude-initial'];
  assert.deepEqual(s.tasks.map(t => t.status), ['active', 'queued']);
  const firstId = s.tasks[0].id;
  applyClaudeHook(state, event('SubagentStart', { agent_id: 'TEST-child', agent_type: 'reviewer' }));
  applyClaudeHook(state, todos(['completed', 'completed']));
  assert.equal(s.tasks[0].status, 'active');
  applyClaudeHook(state, event('SubagentStop', { agent_id: 'TEST-child' }));
  applyClaudeHook(state, event('Stop'));
  assert.equal(s.tasks[0].status, 'active');
  assert.equal(s.tasks.find(t => t.delegation).status, 'active');
  applyClaudeHook(state, event('PostToolUse', { agent_id: 'TEST-child', tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Child private plan', status: 'completed' }] } }));
  assert.ok(!s.tasks.some(t => t.title === 'Child private plan'));
  // A child tool after delivery legitimately reopens that child's activity.
  applyClaudeHook(state, event('SubagentStop', { agent_id: 'TEST-child' }));
  applyClaudeHook(state, todos(['completed', 'completed']));
  assert.equal(s.tasks[0].id, firstId);
  assert.ok(s.tasks.every(t => t.status === 'done'));
  assert.deepEqual(state.sessions['TEST-claude-initial'].tasks, []);
  const failure = applyClaudeHook(state, event('PostToolUseFailure', { tool_name: 'Bash' }));
  assert.equal(failure.status, 'error');
});

test('project installer preserves permissions and other hooks, creates backup and is idempotent', async () => {
  const dir = await temp();
  try {
    await mkdir(resolve(dir, '.claude'));
    const settings = { permissions: { allow: ['Read'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-bridge' }] }] } };
    await writeFile(resolve(dir, '.claude/settings.local.json'), JSON.stringify(settings));
    const one = await installClaudeProject(dir);
    assert.ok(one.backup);
    assert.deepEqual(JSON.parse(await readFile(one.backup, 'utf8')), settings);
    const saved = JSON.parse(await readFile(one.path, 'utf8'));
    assert.deepEqual(saved.permissions, settings.permissions);
    assert.equal(saved.hooks.Stop[0].hooks[0].command, 'other-bridge');
    assert.equal(saved.hooks.Stop.length, 2);
    assert.equal(Object.keys(saved.hooks).length, claudeHookEvents.length);
    assert.equal((await installClaudeProject(dir)).changed, false);
    assert.equal((await readdir(resolve(dir, '.claude'))).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('real hook script reaches isolated server, appears in liveSessions and persists across restart', async () => {
  const dir = await temp();
  let desk;
  const invoke = payload => new Promise((done, fail) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/claude-hook.mjs', import.meta.url))], { env: { ...process.env, NEXUS_BRIDGE_FILE: resolve(dir, 'bridge.json') }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', fail); child.on('exit', code => {
      try {
        assert.equal(code, 0); assert.equal(stderr, '');
        if (['SessionStart', 'UserPromptSubmit'].includes(payload.hook_event_name)) {
          const context = JSON.parse(stdout).hookSpecificOutput;
          assert.equal(context.hookEventName, payload.hook_event_name);
          assert.match(context.additionalContext, /TEST-claude-initial/);
          assert.ok(!stdout.includes('PRIVATE'));
        } else assert.equal(stdout, '');
        done();
      } catch (error) { fail(error); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
  try {
    desk = await createDeskServer({ port: 0, dataDir: dir });
    await invoke(raw('SessionStart'));
    await invoke(raw('UserPromptSubmit', { prompt: 'PRIVATE' }));
    await invoke(raw('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Teste tarefa', status: 'in_progress' }] }, tool_response: 'PRIVATE' }));
    const snapshot = await (await fetch(desk.origin + '/api/state')).json();
    assert.ok(viewedSessions(snapshot.runtime).some(s => s.id === 'claude:TEST-claude-initial'));
    assert.equal(snapshot.runtime.agents['claude:TEST-claude-initial:main'].provider, 'claude');
    assert.equal(snapshot.runtime.observation.sessions['claude:TEST-claude-initial'].tasks[0].status, 'active');
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
    const saved = await readFile(resolve(dir, 'observation.json'), 'utf8');
    assert.ok(!saved.includes('PRIVATE'));
    await desk.close();
    desk = await createDeskServer({ port: 0, dataDir: dir });
    assert.equal(desk.runtime.observation.sessions['claude:TEST-claude-initial'].status, 'waiting');
    assert.equal(desk.runtime.agents['claude:TEST-claude-initial:main'].status, 'waiting');
    assert.equal(desk.runtime.observation.sessions['claude:TEST-claude-initial'].tasks[0].status, 'active');
    await invoke(raw('Stop'));
    assert.equal(desk.runtime.observation.sessions['claude:TEST-claude-initial'].tasks[0].status, 'active');
    const duplicate = raw('PreToolUse', { event_id: 'TEST-duplicate', tool_name: 'Read' });
    await invoke(duplicate);
    const count = desk.runtime.observation.sessions['claude:TEST-claude-initial'].totalEvents;
    await invoke(duplicate);
    assert.equal(desk.runtime.observation.sessions['claude:TEST-claude-initial'].totalEvents, count);
    await desk.close(); desk = null;
    await invoke(raw('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Teste tarefa', status: 'completed' }] }, tool_response: 'PRIVATE' }));
    const queued = await readdir(resolve(dir, 'inbox'));
    assert.equal(queued.length, 1);
    assert.ok(!(await readFile(resolve(dir, 'inbox', queued[0]), 'utf8')).includes('PRIVATE'));
    desk = await createDeskServer({ port: 0, dataDir: dir });
    assert.equal(desk.runtime.observation.sessions['claude:TEST-claude-initial'].tasks[0].status, 'done');
    assert.deepEqual(await readdir(resolve(dir, 'inbox')), []);
  } finally { if (desk) await desk.close(); await rm(dir, { recursive: true, force: true }); }
});
