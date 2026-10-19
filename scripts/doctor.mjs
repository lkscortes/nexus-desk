import { parseSetupArgs, doctor } from '../lib/setup.mjs';

try {
  const options = parseSetupArgs(process.argv.slice(2));
  if (options.help) console.log('Uso: npm run doctor -- [--clients codex|claude|both|none] [--home PERFIL] [--data-dir DIR] [--json]\nInspeciona a instalação sem publicar eventos ou alterar configurações.');
  else {
    const result = await doctor(options);
    if (options.json) console.log(JSON.stringify(result));
    else {
      console.log(`Node ${result.node.version}: ${result.node.supported ? 'OK' : 'requer 24+'}\nEscopo: usuário\nDados: ${result.dataDir}`);
      for (const [client, config] of Object.entries(result.configs)) console.log(`${client}: ${config.error || `MCP ${config.mcp ? 'OK' : 'ausente'} · hooks ${config.hooks ? 'OK' : 'ausentes'} · instruções ${config.instructions ? 'OK' : 'ausentes'}`}`);
      console.log(`Painel: ${result.bridge.status}${result.bridge.origin ? ` · ${result.bridge.origin}` : ''}\nEventos na fila: ${result.queued}`);
      console.log(`Últimos eventos (metadados): ${JSON.stringify(result.recentEvents)}`);
    }
    if (!result.node.supported || Object.values(result.configs).some(config => config.error)) process.exitCode = 1;
  }
} catch (error) { console.error(`Nexus: ${error.message}`); process.exitCode = 1; }
