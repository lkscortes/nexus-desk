import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { resolveDataDir } from '../lib/paths.mjs';
import { createDeskServer } from '../server.mjs';
import { createNexusTools } from '../lib/nexus-mcp.mjs';
import { cleanClaudeHook, applyClaudeHook } from '../lib/claude-observation.mjs';
import { cleanHook } from '../lib/codex-hooks.mjs';

test('data paths agree across explicit hook arguments, environment and existing installs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-paths-'));
  const options = { root: dir, home: dir, env: {}, platform: 'linux', argv: [] };
  try {
    assert.equal(resolveDataDir(options), join(dir, '.local', 'state', 'nexus-desk'));
    await mkdir(join(dir, '.local')); await writeFile(join(dir, '.local', 'config.json'), '{}');
    assert.equal(resolveDataDir(options), join(dir, '.local'));
    assert.equal(resolveDataDir({ ...options, env: { NEXUS_BRIDGE_FILE: join(dir, 'other', 'bridge.json') } }), join(dir, 'other'));
    assert.equal(resolveDataDir({ ...options, env: { NEXUS_DATA_DIR: join(dir, 'new') } }), join(dir, 'new'));
    assert.equal(resolveDataDir({ ...options, env: { NEXUS_DATA_DIR: join(dir, 'new') }, argv: ['--data-dir', join(dir, 'explicit')] }), join(dir, 'explicit'));
  } finally { assert.ok(dir.startsWith(join(tmpdir(), 'nexus-paths-'))); await rm(dir, { recursive: true, force: true }); }
});

test('first Claude hook and MCP share identity; same raw Codex ID remains independent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nexus-provider-'));
  const desk = await createDeskServer({ port: 0, dataDir: dir });
  const claude = createNexusTools({ dataDir: dir, provider: 'claude' });
  const codex = createNexusTools({ dataDir: dir });
  try {
    // Synthetic IDs exist only inside this isolated test server.
    const session_id = 'test-fresh-chat';
    applyClaudeHook(desk.runtime.observation, cleanClaudeHook({ session_id, hook_event_name: 'SessionStart' }));
    await claude('register_conversation', { session_id, title: 'Projeto Claude' });
    await claude('publish_plan', { session_id, plan: [{ id: 'build', step: 'Construir', status: 'in_progress' }] });
    assert.equal((await claude('read_board', { session_id })).tasks[0].status, 'active');
    await codex('register_conversation', { session_id, title: 'Projeto Codex' });
    assert.equal(Object.keys(desk.runtime.observation.sessions).length, 2);
    assert.equal(desk.runtime.agents['claude:test-fresh-chat:main'].provider, 'claude');
    assert.equal(desk.runtime.agents['codex:test-fresh-chat:main'].provider, 'codex');
    await claude('publish_plan', { session_id, plan: [{ id: 'build', step: 'Construir', status: 'completed' }] });
    assert.equal((await claude('read_board', { session_id: 'claude:test-fresh-chat' })).tasks[0].status, 'done');
    assert.equal((await codex('read_board', { session_id })).tasks[0].status, 'queued');
    assert.equal((await claude('read_board', { session_id })).title, 'Projeto Claude');
    await claude('agent_event', { session_id, event: 'Interrupt' });
    assert.equal((await claude('read_board', { session_id })).status, 'waiting');
  } finally { await desk.close(); assert.ok(dir.startsWith(join(tmpdir(), 'nexus-provider-'))); await rm(dir, { recursive: true, force: true }); }
});

test('native Codex and Claude prompts never become dashboard titles', () => {
  const raw = { session_id: 'test-private', hook_event_name: 'UserPromptSubmit', prompt: 'PRIVATE-MESSAGE-CONTENT' };
  assert.ok(!JSON.stringify(cleanHook(raw)).includes('PRIVATE-MESSAGE'));
  assert.ok(!JSON.stringify(cleanClaudeHook(raw)).includes('PRIVATE-MESSAGE'));
  assert.equal(cleanHook({ ...raw, title: 'Resumo aprovado' }).title, 'Resumo aprovado');
});
