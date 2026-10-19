import { readFile } from 'node:fs/promises';
import { resolveBridgeFile } from '../lib/paths.mjs';
export async function sendEvent(event, route = '/api/events') {
  const bridge = JSON.parse(await readFile(resolveBridgeFile(), 'utf8'));
  const response = await fetch(bridge.origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridge.token}` }, body: JSON.stringify(event), signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`Painel respondeu ${response.status}`);
  return response.json();
}
