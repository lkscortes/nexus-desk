// Shared, deterministic rules; no browser or provider dependency.
export function formationPositions(n) {
  const small = { 1: [[25, 30]], 2: [[21, 30], [79, 30]], 3: [[21, 30], [79, 30], [50, 84]], 4: [[21, 30], [79, 30], [21, 84], [79, 84]], 5: [[21, 29], [79, 29], [16, 82], [50, 84], [84, 82]] };
  if (n <= 5) return (small[n] || []).map(([x, y]) => ({ x, y }));
  const columns = n <= 8 ? 3 : 4;
  const points = [];
  for (let i = 0; i < columns; i++) points.push({ x: 12 + i * 76 / (columns - 1), y: 27 });
  const middle = n - columns * 2;
  for (let i = 0; i < middle; i++) points.push({ x: i % 2 ? 88 : 12, y: 47 + Math.floor(i / 2) * 17 });
  for (let i = 0; i < columns; i++) points.push({ x: 12 + i * 76 / (columns - 1), y: 84 });
  return points.slice(0, n);
}
export function migrateFormation(agents) {
  const old = { 1: [[50, 36]], 2: [[25, 45], [75, 45]], 3: [[25, 37], [75, 37], [50, 78]], 4: [[25, 33], [75, 33], [25, 77], [75, 77]], 5: [[25, 30], [75, 30], [18, 75], [50, 79], [82, 75]] }[agents.length];
  if (old && agents.every((a, i) => a.x === old[i][0] && a.y === old[i][1])) {
    const positions = formationPositions(agents.length);
    return agents.map((a, i) => ({ ...a, ...positions[i] }));
  }
  return agents;
}
export function runtimeTransfers(previous, incoming) {
  const seen = new Set(previous.events.map(e => e.id));
  const statuses = new Map(Object.entries(previous.agents).map(([id, a]) => [id, a.status]));
  const active = new Set(['thinking', 'reading', 'writing', 'running']);
  const jobs = [];
  for (const event of [...incoming.events].reverse()) {
    if (seen.has(event.id)) continue;
    const before = statuses.get(event.agentId);
    if (event.status === 'done' && before !== 'done') jobs.push({ agentId: event.agentId, kind: 'deliver', title: event.message });
    else if (active.has(event.status) && !active.has(before)) jobs.push({ agentId: event.agentId, kind: 'pickup', title: event.message });
    statuses.set(event.agentId, event.status);
  }
  return jobs;
}
