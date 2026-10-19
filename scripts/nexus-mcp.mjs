import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createNexusTools, nexusTools } from '../lib/nexus-mcp.mjs';
import { resolveDataDir } from '../lib/paths.mjs';

const callTool = createNexusTools({ dataDir: resolveDataDir(), provider: process.env.NEXUS_PROVIDER || 'codex' });
const supportedProtocols = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let req;
  try { if (line.length > 1_000_000) throw new Error('Mensagem grande demais.'); req = JSON.parse(line); }
  catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }); continue; }
  if (!req || Array.isArray(req) || req.jsonrpc !== '2.0' || typeof req.method !== 'string') { send({ jsonrpc: '2.0', id: req?.id ?? null, error: { code: -32600, message: 'Requisição inválida' } }); continue; }
  if (!Object.hasOwn(req, 'id')) continue;
  let result;
  if (req.method === 'initialize') result = { protocolVersion: supportedProtocols.includes(req.params?.protocolVersion) ? req.params.protocolVersion : supportedProtocols.at(-1), capabilities: { tools: {} }, serverInfo: { name: 'nexus-desk', version: '0.2.0-alpha.1' }, instructions: 'Nexus acompanha trabalho real. Registre a conversa com ID real fornecido pelo cliente/hook e o provedor correto. Confira confirmed; queued não significa publicação confirmada. Nunca invente agentes.' };
  else if (req.method === 'ping') result = {};
  else if (req.method === 'tools/list') result = { tools: nexusTools };
  else if (req.method === 'tools/call') {
    try { const value = await callTool(req.params?.name, req.params?.arguments); result = { content: [{ type: 'text', text: JSON.stringify(value) }], ...(value.confirmed === false ? { isError: true } : {}) }; }
    catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
  } else { send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Método não disponível' } }); continue; }
  send({ jsonrpc: '2.0', id: req.id, result });
}
