import test from 'node:test';
import assert from 'node:assert/strict';
import { formationPositions, migrateFormation, runtimeTransfers } from '../public/workflow.js';

test('all supported team sizes leave the central table corridor open', () => {
  for (let n = 0; n <= 12; n++) {
    const positions = formationPositions(n);
    assert.equal(positions.length, n);
    assert.equal(new Set(positions.map(p => `${p.x},${p.y}`)).size, n);
    for (const p of positions) {
      assert.ok(p.x >= 12 && p.x <= 88 && p.y >= 25 && p.y <= 84);
      assert.ok(p.y <= 30 || p.y >= 80 || p.x <= 16 || p.x >= 84);
    }
  }
});
test('migration spreads original presets while preserving custom positions and identity', () => {
  const original = [{id:'a',x:25,y:37}, {id:'b',x:75,y:37}, {id:'c',x:50,y:78}];
  assert.deepEqual(migrateFormation(original).map(a => [a.id,a.x,a.y]), [['a',21,30],['b',79,30],['c',50,84]]);
  const custom = [{id:'a',x:26,y:37}, ...original.slice(1)];
  assert.deepEqual(migrateFormation(custom), custom);
  assert.deepEqual(migrateFormation(migrateFormation(original)), migrateFormation(original));
});
test('live animation follows new lifecycle transitions without replaying history or inventing dependencies', () => {
  const prior = { agents: { a: {status:'writing'} }, events: [{id:'old',agentId:'a',status:'writing'}] };
  const next = { events: [
    {id:'3',agentId:'a',status:'done',message:'Done'},
    {id:'2',agentId:'b',status:'running',message:'Run'},
    {id:'1',agentId:'b',status:'reading',message:'Read'},
    ...prior.events
  ] };
  assert.deepEqual(runtimeTransfers(prior,next), [{agentId:'b',kind:'pickup',title:'Read'},{agentId:'a',kind:'deliver',title:'Done'}]);
  assert.deepEqual(runtimeTransfers({agents:{a:{status:'done'},b:{status:'running'}},events:next.events},next), []);
});
