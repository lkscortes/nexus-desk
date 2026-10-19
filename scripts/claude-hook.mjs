import { sendEvent } from './bridge.mjs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanClaudeHook, claudePlanningContext } from '../lib/claude-observation.mjs';
import { resolveBridgeFile } from '../lib/paths.mjs';
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 2_000_000) process.exit(0); }
try {
  const event = cleanClaudeHook(JSON.parse(input));
  if (event) {
    const bridgePath = resolveBridgeFile();
    const inbox = resolve(dirname(bridgePath), 'inbox');
    await mkdir(inbox, { recursive: true });
    const path = resolve(inbox, event.eventId.replace(/[^a-zA-Z0-9-]/g, '') + '.json');
    await writeFile(path, JSON.stringify(event));
    try { const ack = await sendEvent(event, '/api/hooks/claude'); if (ack.received === true) await unlink(path).catch(() => {}); } catch {}
    if (['SessionStart', 'UserPromptSubmit'].includes(event.hook_event_name)) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event.hook_event_name, additionalContext: claudePlanningContext(event.session_id) } }));
    }
  }
} catch { /* An offline dashboard must not block Claude. */ }
// Always observational: no hook decision or permission override is returned.
