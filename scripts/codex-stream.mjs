import { createInterface } from 'node:readline';
import { fromCodex } from '../lib/adapters.mjs';
import { sendEvent } from './bridge.mjs';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const context = { threadId: process.env.NEXUS_THREAD_ID, name: process.env.NEXUS_AGENT_NAME || 'Codex' };
let warned = false;
for await (const line of lines) {
  process.stdout.write(line + '\n');
  try {
    const payload = JSON.parse(line.replace(/^\uFEFF/, ''));
    context.threadId = payload.thread_id || payload.params?.threadId || payload.params?.thread?.id || context.threadId;
    const event = fromCodex(payload, context);
    if (event) await sendEvent(event);
  } catch (error) {
    if (!(error instanceof SyntaxError) && !warned) { console.error('Nexus: painel indisponível; o fluxo do Codex continua.'); warned = true; }
  }
}
