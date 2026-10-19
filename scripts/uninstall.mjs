import { parseSetupArgs, uninstall } from '../lib/setup.mjs';

try {
  const options = parseSetupArgs(process.argv.slice(2));
  if (options.help) console.log('Uso: npm run uninstall -- [--clients codex|claude|both|none] [--home PERFIL] [--data-dir DIR] [--json]\nRemove somente MCP, hooks e blocos de instrução Nexus. Dados e backups são preservados.');
  else {
    const result = await uninstall(options);
    console.log(options.json ? JSON.stringify(result) : `Integração Nexus removida de ${result.changed.length} arquivo(s). Reabra o cliente.\nDados e backups preservados em ${result.dataDir}`);
  }
} catch (error) { console.error(`Nexus: ${error.message}`); process.exitCode = 1; }
