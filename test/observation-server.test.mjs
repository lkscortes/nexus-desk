import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createDeskServer } from '../server.mjs';
import { cleanHook } from '../lib/codex-hooks.mjs';
import { spawn } from 'node:child_process';

test('report-plan replaces a group through the backend and persists only individual validations', async () => {
  const base = fileURLToPath(new URL('../.local/', import.meta.url)); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'replace-plan-test-')); let desk;
  try {
    for (const folder of ['scripts', 'lib', '.local']) await mkdir(join(dir, folder));
    for (const file of ['scripts/report-plan.mjs', 'scripts/codex-hook.mjs', 'scripts/bridge.mjs', 'lib/codex-hooks.mjs', 'lib/paths.mjs']) await copyFile(fileURLToPath(new URL('../' + file, import.meta.url)), join(dir, file));
    desk = await createDeskServer({ port: 0, dataDir: join(dir, '.local') });
    const publish = async document => {
      await writeFile(join(dir, 'plan.json'), JSON.stringify(document));
      await new Promise((done, reject) => {
        const child = spawn(process.execPath, [join(dir, 'scripts/report-plan.mjs'), '--session', 'sampleSession', '--file', join(dir, 'plan.json')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = ''; child.stderr.on('data', d => { stderr += d; });
        child.on('error', reject); child.on('exit', code => code ? reject(new Error(stderr)) : done());
      });
    };
    await publish({ plan: [{ step: 'Grupo', status: 'pending' }, { step: 'Etapa A', status: 'completed' }] });
    const individual = { superseded_steps: ['Grupo'], plan: [{ id: 'step-a', step: 'Etapa A', status: 'completed' }, { id: 'step-b', step: 'Etapa B', status: 'pending' }, { id: 'list', step: 'Etapa C', status: 'pending' }] };
    await publish(individual); await publish(individual);
    const state = await fetch(desk.origin + '/api/state').then(r => r.json());
    const tasks = state.runtime.observation.sessions.sampleSession.tasks;
    assert.deepEqual(tasks.map(t => [t.title, t.status]), [['Etapa A', 'done'], ['Etapa B', 'queued'], ['Etapa C', 'queued']]);
    const saved = JSON.parse(await readFile(join(dir, '.local', 'observation.json'), 'utf8'));
    assert.deepEqual(saved.observation.sessions.sampleSession.tasks, tasks);
    assert.equal(saved.observation.sessions.sampleSession.archivedTasks[0].title, 'Grupo');
    await publish({ plan: [{ id: 'step-a', step: 'Etapa A aprovada', status: 'completed' }] });
    const renamed = await fetch(desk.origin + '/api/state').then(r => r.json());
    assert.equal(renamed.runtime.observation.sessions.sampleSession.tasks.length, 3);
    assert.equal(renamed.runtime.observation.sessions.sampleSession.tasks.find(t => t.externalId === 'step-a').id, tasks.find(t => t.externalId === 'step-a').id);
    await publish({ plan: [], superseded_ids: ['step-b'] });
    const removed = await fetch(desk.origin + '/api/state').then(r => r.json());
    assert.ok(!removed.runtime.observation.sessions.sampleSession.tasks.some(t => t.externalId === 'step-b'));
    assert.equal(removed.runtime.observation.sessions.sampleSession.archivedTasks.length, 2);
    await desk.close(); desk = null;
    await assert.rejects(publish({ plan: [{ step: 'Entrega durante indisponibilidade', status: 'completed' }] }), /sem confirmação do Nexus/);
    desk = await createDeskServer({ port: 0, dataDir: join(dir, '.local') });
    assert.equal(desk.runtime.observation.sessions.sampleSession.archivedTasks.length, 2);
    assert.ok(desk.runtime.observation.sessions.sampleSession.tasks.some(t => t.title === 'Entrega durante indisponibilidade'));
  } finally { if (desk) await desk.close(); assert.ok(dir.startsWith(join(base, 'replace-plan-test-'))); await rm(dir, { recursive: true, force: true }); }
});
test('real hook endpoint updates SSE and board, persists, deduplicates inbox after restart', async () => {
  const base = fileURLToPath(new URL('../.local/', import.meta.url)); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'observation-test-'));
  let desk = await createDeskServer({ port: 0, dataDir: dir });
  const post = async e => {
    const r = await fetch(desk.origin + '/api/hooks/codex', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${desk.token}` }, body: JSON.stringify(e) });
    assert.equal(r.status, 202); assert.equal((await r.json()).received, true);
  };
  const abort = new AbortController(); let reader;
  try {
    reader = (await fetch(desk.origin + '/api/stream', { signal: abort.signal })).body.getReader(); await reader.read();
    const e = cleanHook({ session_id: 'pilot', hook_event_name: 'PostToolUse', tool_name: 'update_plan', tool_input: { plan: [{ step: 'Etapa real', status: 'in_progress' }] } });
    await post(e); const streamed = await reader.read(); assert.match(new TextDecoder().decode(streamed.value), /Etapa real/);
    await post(e); assert.equal(desk.runtime.totalEvents, 1);
    await reader.cancel(); reader = null;
    await desk.close(); desk = null;
    await mkdir(join(dir, 'inbox')); await writeFile(join(dir, 'inbox', 'duplicate.json'), JSON.stringify(e));
    const fresh = cleanHook({ session_id: 'new-chat', hook_event_name: 'SessionStart' }); await writeFile(join(dir, 'inbox', 'new.json'), JSON.stringify(fresh));
    desk = await createDeskServer({ port: 0, dataDir: dir });
    assert.equal(desk.runtime.observation.sessions.pilot.tasks[0].status, 'active');
    assert.equal(desk.runtime.agents['codex:pilot:main'].status, 'waiting');
    assert.equal(desk.runtime.agents['codex:pilot:main'].connection, 'awaiting-event');
    assert.deepEqual(desk.runtime.observation.sessions['new-chat'].tasks, []);
    assert.equal(desk.runtime.totalEvents, 1, 'Only fresh inbox event is counted');
    await post(cleanHook({ session_id: 'pilot', hook_event_name: 'PreToolUse', tool_name: 'read_file' }));
    assert.equal(desk.runtime.agents['codex:pilot:main'].connection, 'receiving');
    assert.equal(desk.runtime.agents['codex:pilot:main'].status, 'reading');
  } finally {
    abort.abort(); if (reader) await reader.cancel().catch(() => {}); if (desk) await desk.close();
    assert.ok(dir.startsWith(join(base, 'observation-test-'))); await rm(dir, { recursive: true, force: true });
  }
});
test('actual hook process publishes an instruction and returns valid Codex context', async () => {
  const base = fileURLToPath(new URL('../.local/', import.meta.url)); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'hook-process-test-')); let desk;
  try {
    for (const folder of ['scripts', 'lib', '.local']) await mkdir(join(dir, folder));
    for (const file of ['scripts/codex-hook.mjs', 'scripts/bridge.mjs', 'lib/codex-hooks.mjs', 'lib/paths.mjs']) await copyFile(fileURLToPath(new URL('../' + file, import.meta.url)), join(dir, file));
    desk = await createDeskServer({ port: 0, dataDir: join(dir, '.local') });
    const output = await new Promise((done, reject) => {
      const child = spawn(process.execPath, [join(dir, 'scripts', 'codex-hook.mjs')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
      child.on('error', reject); child.on('exit', code => code ? reject(new Error(stderr)) : done(stdout));
      child.stdin.end(JSON.stringify({ session_id: 'hook-chat', hook_event_name: 'UserPromptSubmit', turn_id: 'turn-1', prompt: 'Verificar conexão de teste' }));
    });
    assert.match(JSON.parse(output).hookSpecificOutput.additionalContext, /update_plan/);
    assert.equal(desk.runtime.observation.sessions['hook-chat'].tasks[0].status, 'queued');
    assert.equal(desk.runtime.agents['codex:hook-chat:main'].status, 'thinking');
  } finally { if (desk) await desk.close(); assert.ok(dir.startsWith(join(base, 'hook-process-test-'))); await rm(dir, { recursive: true, force: true }); }
});
