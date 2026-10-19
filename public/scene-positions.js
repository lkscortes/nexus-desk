export const clampScenePosition = ({ x, y }) => ({
  x: Math.max(12, Math.min(88, Number(x) || 50)),
  y: Math.max(25, Math.min(84, Number(y) || 50))
});

export function scenePositionKey(sessionId, runtimeId) {
  return `${sessionId}\u0000${runtimeId}`;
}

export function loadScenePositions(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function saveScenePosition(storage, key, positions, sessionId, runtimeId, position) {
  const next = { ...positions, [scenePositionKey(sessionId, runtimeId)]: clampScenePosition(position) };
  try { storage.setItem(key, JSON.stringify(next)); } catch { /* Position cache is optional. */ }
  return next;
}
