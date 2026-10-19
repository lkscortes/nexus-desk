import { fromClaude, fromCodex } from '../lib/adapters.mjs';
import { sendEvent } from './bridge.mjs';
const claude = fromClaude({ session_id: 'integration-test-claude', agent_type: 'Claude · teste', hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'fixture.ts' } });
const codex = fromCodex({ type: 'item.started', item: { type: 'file_change' } }, { threadId: 'integration-test-codex', name: 'Codex · teste' });
for (const event of [claude, codex]) await sendEvent({ ...event, message: `Teste de integração · ${event.message}` });
console.log('Dois eventos de teste enviados. Não são sessões de IA reais. Veja Conexões → Eventos reais.');
