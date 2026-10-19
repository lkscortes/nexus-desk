import test from 'node:test';
import assert from 'node:assert/strict';
import { viewedSessions, liveTeam, displayedSessionAgents, completionGraceMs } from '../public/live-observation.js';
const now = Date.parse('2026-10-08T20:00:00Z');
const stamp = age => new Date(now - age).toISOString();
const session = (id, status = 'thinking', age = 0) => ({ id, title: `Projeto ${id}`, status, updatedAt: stamp(age), tasks: [] });
const agent = (sessionId, suffix, role, status = 'reading', age = 0) => ({ agentId: `codex:${sessionId}:${suffix}`, sessionId, parentId: suffix === 'main' ? null : `codex:${sessionId}:main`, provider: 'codex', name: role, role, status, timestamp: stamp(age) });
const characters = [
  { id: 'orange', name: 'Coordenador', role: 'Coordenação', provider: 'codex', color: '#ff8800', binding: 'codex:old:main' },
  { id: 'blue', name: 'Agente 2', role: 'Construção', provider: 'codex', binding: 'codex:old:builder' },
  { id: 'pink', name: 'Agente 1', role: 'Validação', provider: 'codex', binding: 'codex:old:reviewer' }
];
test('concurrent conversations show together; completed sessions expire and history stays accessible', () => {
  const sessions = { a: session('a'), b: session('b'), old: session('old', 'done', 60000) };
  const agents = Object.fromEntries([agent('a', 'main', 'Coordenação'), agent('b', 'main', 'Coordenação'), agent('old', 'main', 'Coordenação', 'done', 60000)].map(a => [a.agentId, a]));
  const runtime = { agents, observation: { sessions } };
  assert.deepEqual(viewedSessions(runtime, '', now).map(s => s.id), ['a', 'b']);
  assert.deepEqual(viewedSessions(runtime, 'old', now).map(s => s.id), ['old']);
  sessions.a.status = 'done'; agents['codex:a:main'].status = 'done';
  assert.ok(viewedSessions(runtime, '', now + completionGraceMs - 1).some(s => s.id === 'a'));
  assert.ok(!viewedSessions(runtime, '', now + completionGraceMs).some(s => s.id === 'a'));
  agents['codex:a:main'].status = 'thinking'; sessions.a.updatedAt = stamp(0);
  assert.ok(viewedSessions(runtime, '', now).some(s => s.id === 'a'));
});
test('identities and translated roles are reused across projects without duplicate coordinators', () => {
  const actual = [agent('new', 'reviewer', 'reviewer'), agent('new', 'main', 'Coordenação'), agent('new', 'builder', 'builder')];
  const team = liveTeam(characters, actual, session('new'));
  assert.equal(team.length, 3);
  assert.equal(team.find(a => !a.parentId).templateId, 'orange');
  assert.equal(team.find(a => a.role === 'Validação').templateId, 'pink');
  assert.equal(team.find(a => a.role === 'Construção').templateId, 'blue');
  assert.equal(team.find(a => !a.parentId).color, '#ff8800');
  const other = liveTeam(characters, [agent('other', 'main', 'Coordenação')], session('other'));
  assert.notEqual(team[0].id, other[0].id);
  assert.deepEqual(characters.map(c => c.binding), ['codex:old:main', 'codex:old:builder', 'codex:old:reviewer']);
});
test('session-only character overrides one Claude conversation while the shared base remains reusable', () => {
  const base = { id: 'claude-coordinator', name: 'Base', role: 'Coordenação', provider: 'claude', color: '#ff70cc', hue: 160, scale: 110, sprite: 'base-sprite', binding: '' };
  const override = { ...base, id: 'session-avatar-claude-a-coordinator', name: 'Projeto A', color: '#be8bff', hue: 100, scale: 100, sprite: 'override-sprite', binding: 'claude:session-a:main', sessionOnly: true };
  const sessionA = session('claude:session-a'), sessionB = session('claude:session-b');
  const actual = id => [{ agentId: `${id}:main`, sessionId: id, provider: 'claude', parentId: null, name: 'Claude', role: 'Coordenação', color: '#55c8ff', hue: 42, sprite: 'observed-sprite', scale: 80, status: 'thinking', timestamp: stamp(0) }];

  const teamA = liveTeam([base, override], actual(sessionA.id), sessionA, now);
  const teamB = liveTeam([base, override], actual(sessionB.id), sessionB, now);
  assert.equal(teamA[0].templateId, override.id);
  assert.equal(teamA[0].name, 'Projeto A');
  assert.equal(teamA[0].color, '#be8bff');
  assert.equal(teamA[0].hue, 100);
  assert.equal(teamA[0].scale, 100);
  assert.equal(teamA[0].sprite, 'override-sprite');
  assert.equal(teamB[0].templateId, base.id);
  assert.equal(teamB[0].name, 'Base');
  assert.equal(teamB[0].color, '#ff70cc');
  assert.equal(teamB[0].sprite, 'base-sprite');

  // Older server processes strip unknown fields; the reserved ID prefix keeps
  // the persisted override isolated until the server restarts.
  const legacyApiOverride = { ...override, sessionOnly: false };
  const legacyTeamA = liveTeam([base, legacyApiOverride], actual(sessionA.id), sessionA, now);
  const legacyTeamB = liveTeam([base, legacyApiOverride], actual(sessionB.id), sessionB, now);
  assert.equal(legacyTeamA[0].templateId, legacyApiOverride.id);
  assert.equal(legacyTeamB[0].templateId, base.id);
  const overrideB = { ...override, id: 'session-avatar-b', binding: `${sessionB.id}:main`, name: 'Projeto B', color: '#6df5b0', sprite: '' };
  const saved = [base, override, overrideB];
  assert.equal(liveTeam(saved, actual(sessionA.id), sessionA, now)[0].sprite, 'override-sprite');
  const editedB = liveTeam(saved, actual(sessionB.id), sessionB, now)[0];
  assert.equal(editedB.name, 'Projeto B');
  assert.equal(editedB.color, '#6df5b0');
  assert.equal(editedB.sprite, '', 'Choosing the original skin clears an observed custom image');
});
test('requested extra real workers appear; no invented workers or cross-provider bindings', () => {
  const actual = [agent('a', 'main', 'Coordenação'), agent('a', 'b1', 'builder'), agent('a', 'b2', 'builder'), agent('a', 'r1', 'reviewer')];
  const team = liveTeam(characters, actual, session('a'));
  assert.equal(team.length, 4);
  assert.equal(new Set(team.map(a => a.runtimeId)).size, 4);
  assert.equal(team.filter(a => !a.configured).length, 1);
  assert.equal(team.find(a => a.runtimeId === 'codex:a:r1').templateId, 'pink');
  assert.equal(team.find(a => a.runtimeId === 'codex:a:b2').configured, false);
  assert.equal(liveTeam(characters, [actual[0]], session('a')).length, 1);
  assert.equal(liveTeam(characters, [{ ...actual[0], provider: 'claude' }], session('a'))[0].configured, false);
});
test('old deliveries disappear from active scene but remain in historical team', () => {
  const records = [agent('a', 'main', 'Coordenação'), agent('a', 'old', 'reviewer', 'done', 60000), agent('a', 'fresh', 'builder', 'done', 1000)];
  const runtime = { agents: Object.fromEntries(records.map(a => [a.agentId, a])) };
  assert.deepEqual(displayedSessionAgents(runtime, 'a', false, now).map(a => a.agentId), ['codex:a:main', 'codex:a:fresh']);
  assert.equal(displayedSessionAgents(runtime, 'a', true, now).length, 3);
});
test('historical scene retains configured helpers and hides obsolete unbound participants', () => {
  const configured = characters.map(c => ({ ...c, binding: c.id === 'orange' ? 'codex:a:main' : c.id === 'blue' ? 'codex:a:builder' : 'codex:a:reviewer' }));
  const actual = [agent('a', 'main', 'Coordenação', 'done', 60000), agent('a', 'builder', 'builder', 'done', 60000), agent('a', 'reviewer', 'reviewer', 'done', 60000), agent('a', 'nova', 'Nova', 'done', 60000), agent('a', 'orbit', 'Orbit', 'offline', 60000)];
  const team = liveTeam(configured, actual, session('a'), now);
  assert.equal(team.length, 3);
  assert.deepEqual(new Set(team.map(a => a.templateId)), new Set(['orange', 'blue', 'pink']));
  assert.equal(actual.length, 5, 'Historical records are preserved');
});
test('ended or stale conversations cannot remain active through old child states', () => {
  const runtime = { observation: { sessions: { ended: session('ended', 'offline'), stale: session('stale', 'thinking', 31 * 60000) } },
    agents: { child: agent('ended', 'child', 'builder'), stale: agent('stale', 'main', 'Coordenação') } };
  assert.deepEqual(viewedSessions(runtime, '', now), []);
  assert.equal(viewedSessions(runtime, 'ended', now).length, 1);
});
