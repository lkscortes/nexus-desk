import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHook, cleanHook, createObservation, restoreObservation } from '../lib/codex-hooks.mjs';
const publish = (state, plan, extra = {}, session = 'game') => applyHook(state, cleanHook({ session_id: session, hook_event_name: 'PostToolUse', tool_name: 'update_plan', tool_input: { plan, ...extra } }));
test('explicit card ID survives renaming, state updates and legacy title-only publications', () => {
  const state = createObservation();
  publish(state, [{ step: 'Roleta', status: 'pending' }]);
  const id = state.sessions.game.tasks[0].id;
  publish(state, [{ id: 'validation-roulette', step: 'Roleta', status: 'in_progress' }]);
  assert.equal(state.sessions.game.tasks[0].id, id, 'Existing card adopts an external ID');
  publish(state, [{ id: 'validation-roulette', step: 'Roleta aprovada', status: 'completed' }]);
  assert.equal(state.sessions.game.tasks.length, 1);
  assert.equal(state.sessions.game.tasks[0].id, id);
  assert.equal(state.sessions.game.tasks[0].status, 'done');
  publish(state, [{ step: 'Roleta aprovada', status: 'completed' }]);
  assert.equal(state.sessions.game.tasks.length, 1);
  assert.equal(state.sessions.game.tasks[0].externalId, 'validation-roulette');
});
test('splitting archives the exact old card; omitted tasks and other sessions survive', () => {
  const state = createObservation();
  publish(state, [{ id: 'group', step: 'Roleta, Dados e lista', status: 'pending' }, { id: 'unrelated', step: 'Quartos', status: 'pending' }]);
  publish(state, [{ id: 'group', step: 'Outro projeto', status: 'pending' }], {}, 'other');
  const split = [{ id: 'roulette', step: 'Roleta', status: 'completed' }, { id: 'dice', step: 'Dados', status: 'pending' }, { id: 'list', step: 'Lista', status: 'pending' }];
  publish(state, split, { superseded_ids: ['group'] });
  publish(state, split, { superseded_ids: ['group'] });
  const game = state.sessions.game;
  assert.equal(game.tasks.length, 4);
  assert.ok(game.tasks.some(t => t.externalId === 'unrelated'));
  assert.ok(!game.tasks.some(t => t.externalId === 'group'));
  assert.equal(game.archivedTasks.length, 1);
  assert.equal(game.archivedTasks[0].status, 'queued', 'Replacement does not pretend completion');
  assert.equal(game.archivedTasks[0].replacedBy.length, 3);
  assert.equal(state.sessions.other.tasks[0].externalId, 'group');
  assert.equal(restoreObservation(structuredClone(state)).sessions.game.archivedTasks.length, 1);
});
test('internal IDs can address old cards and an empty plan can explicitly archive one', () => {
  const state = createObservation();
  publish(state, [{ step: 'Antigo', status: 'pending' }]);
  const id = state.sessions.game.tasks[0].id;
  publish(state, [{ id, step: 'Renomeado', status: 'completed' }]);
  assert.equal(state.sessions.game.tasks.length, 1);
  publish(state, [], { superseded_ids: [id] });
  assert.equal(state.sessions.game.tasks.length, 0);
  assert.equal(state.sessions.game.archivedTasks[0].title, 'Renomeado');
});
test('explicit replacement never removes current IDs or delegation cards', () => {
  const state = createObservation();
  applyHook(state, cleanHook({ session_id: 'game', hook_event_name: 'SubagentStart', agent_id: 'child' }));
  publish(state, [{ id: 'work', step: 'Construir', status: 'completed' }], { superseded_ids: ['work'], superseded_steps: ['Delegação · Subagente'] });
  assert.equal(state.sessions.game.tasks.length, 2);
  assert.equal(state.sessions.game.tasks.find(t => t.externalId === 'work').status, 'active');
});
test('invalid and duplicate external IDs are rejected', () => {
  const raw = plan => ({ session_id: 'game', hook_event_name: 'PostToolUse', tool_name: 'update_plan', tool_input: { plan } });
  assert.equal(cleanHook(raw([{ id: 'same', step: 'A', status: 'pending' }, { id: 'same', step: 'B', status: 'pending' }])), null);
  assert.equal(cleanHook(raw([{ id: '../wrong', step: 'A', status: 'pending' }])), null);
});
