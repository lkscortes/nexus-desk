import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const session = process.env.CODEX_THREAD_ID || process.argv[2];
if (!session) throw new Error('Informe o ID real da conversa ou use CODEX_THREAD_ID.');
const messages = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'nexus-diagnostic', version: '1.0.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_board', arguments: { session_id: session } } }
];
const child = spawnSync(process.execPath, [fileURLToPath(new URL('./nexus-mcp.mjs', import.meta.url))], { input: messages.map(m => JSON.stringify(m)).join('\n') + '\n', encoding: 'utf8', timeout: 10000, windowsHide: true });
if (child.error || child.status !== 0) throw child.error || new Error('Falha ao iniciar MCP.');
const responses = child.stdout.trim().split('\n').map(line => JSON.parse(line));
const boardResult = responses.find(r => r.id === 3)?.result;
if (!boardResult || boardResult.isError) throw new Error(boardResult?.content?.[0]?.text || 'Sem resposta do MCP.');
const board = JSON.parse(boardResult.content[0].text);
console.log(JSON.stringify({ server: responses.find(r => r.id === 1)?.result?.serverInfo, tools: responses.find(r => r.id === 2)?.result?.tools.map(t => t.name), session_id: board.session_id, title: board.title, tasks: board.tasks?.length, integrationStages: board.tasks?.filter(t => t.id.startsWith('nexus-global-')).map(t => ({ id: t.id, status: t.status })) }, null, 2));
