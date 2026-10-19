import test from 'node:test';
import assert from 'node:assert/strict';
import { clampScenePosition, loadScenePositions, saveScenePosition, scenePositionKey } from '../public/scene-positions.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('clamps positions to the scene bounds', () => {
  assert.deepEqual(clampScenePosition({ x: 3, y: 99 }), { x: 12, y: 84 });
});

test('persists live positions independently by conversation and runtime agent', () => {
  const storage = memoryStorage(), key = 'positions';
  let positions = saveScenePosition(storage, key, {}, 'session-a', 'runtime-1', { x: 30, y: 40 });
  positions = saveScenePosition(storage, key, positions, 'session-b', 'runtime-1', { x: 70, y: 60 });
  assert.equal(positions[scenePositionKey('session-a', 'runtime-1')].x, 30);
  assert.equal(positions[scenePositionKey('session-b', 'runtime-1')].x, 70);
  assert.deepEqual(loadScenePositions(storage, key), positions);
});

test('invalid position cache data falls back to an empty map', () => {
  const storage = memoryStorage(); storage.setItem('positions', '{');
  assert.deepEqual(loadScenePositions(storage, 'positions'), {});
});
