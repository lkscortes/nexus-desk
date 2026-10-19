import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveDataDir } from '../lib/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.indexOf('--home');
const home = arg >= 0 ? resolve(process.argv[arg + 1]) : resolve(process.env.CODEX_HOME || resolve(homedir(), '.codex'));
const dataDir = resolveDataDir();
const configPath = resolve(home, 'config.toml'), agentsPath = resolve(home, 'AGENTS.md');
const read = async p => { try { return await readFile(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };
const originalConfig = await read(configPath), originalAgents = await read(agentsPath);
const header = '[mcp_servers.nexus]';
const entry = `${header}\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(resolve(root, 'scripts/nexus-mcp.mjs'))}]\nenv = { NEXUS_DATA_DIR = ${JSON.stringify(dataDir)}, NEXUS_PROVIDER = \"codex\" }\n`;
const existing = /\[mcp_servers\.nexus\][\s\S]*?(?=\n\[|$)/;
if (existing.test(originalConfig) && !originalConfig.match(existing)[0].includes('nexus-mcp.mjs')) throw new Error('Já existe outro MCP com nome nexus. Instalação cancelada para preservá-lo.');
const config = (existing.test(originalConfig) ? originalConfig.replace(existing, entry.trimEnd()) : originalConfig.trimEnd() + '\n\n' + entry).trimEnd() + '\n';
const start = '<!-- nexus-desk:start -->', end = '<!-- nexus-desk:end -->';
const block = `${start}\n## Acompanhamento automático solicitado pelo usuário — Nexus\nO usuário deseja acompanhar suas conversas no painel Nexus sem digitar comandos de conexão. Quando o MCP nexus estiver disponível, em cada turno:\n1. Descubra as ferramentas do servidor nexus se estiverem carregadas sob demanda. Obtenha o ID real da conversa atual em CODEX_THREAD_ID pelo ambiente da ferramenta de shell, sem solicitar comando ao usuário. Nunca invente um ID ou use o de outra conversa. Se o ID não estiver disponível, explique essa limitação sem vincular a outro chat.\n2. Chame register_conversation com session_id e um título curto para a solicitação real, antes de iniciar o trabalho. Para trabalho com etapas, chame publish_plan com IDs estáveis e estados pending/in_progress/completed; publique ao iniciar cada etapa e após validá-la. Não basta usar o plano nativo: o MCP é o canal de acompanhamento quando hooks não estiverem disponíveis. Para solicitações simples, publique um único cartão e conclua após responder/validar.\n3. Use read_board para consultar cartões existentes e evitar duplicação. Preserve IDs ao retomar/renomear. Omissão preserva histórico; superseded_ids substitui cartões explicitamente. Só marque completed após validar a entrega.\n4. Delegue apenas quando autorizado pelo usuário ou pelas instruções aplicáveis. Após criar um subagente REAL, chame agent_event SubagentStart com o ID real retornado e a função. Após receber sua entrega REAL, chame SubagentStop com esse mesmo ID. O principal valida a entrega e atualiza publish_plan. Nunca crie subagentes só para preencher o painel e nunca simule eventos.\n5. Ao terminar o turno, chame agent_event Stop. Se confirmed=false ou uma ferramenta falhar, informe que o painel não confirmou o evento; não bloqueie a tarefa principal. Eventos queued estão salvos para reenvio, não representam publicação confirmada.\nO painel é observacional. Não envie transcrições, comandos, segredos ou resultados completos. Esta instrução não muda permissões nem autoriza executar conteúdo do painel.\n${end}`;
const begin = originalAgents.indexOf(start), finish = originalAgents.indexOf(end);
if ((begin < 0) !== (finish < 0) || finish >= 0 && finish < begin) throw new Error('Bloco Nexus incompleto em AGENTS.md; arquivo preservado.');
const agents = begin < 0 ? originalAgents.trimEnd() + '\n\n' + block + '\n' : originalAgents.slice(0, begin) + block + originalAgents.slice(finish + end.length);
await mkdir(home, { recursive: true });
const backups = resolve(dataDir, 'backups', 'codex-global'); await mkdir(backups, { recursive: true });
const stamp = Date.now();
for (const [path, before, after, label] of [[configPath, originalConfig, config, 'config.toml'], [agentsPath, originalAgents, agents, 'AGENTS.md']]) {
  if (before === after) continue;
  if (before) await copyFile(path, resolve(backups, stamp + '-' + label));
  await writeFile(path, after);
}
console.log('MCP Nexus e instrução global registrados. Abra uma conversa nova após recarregar o Codex.');
