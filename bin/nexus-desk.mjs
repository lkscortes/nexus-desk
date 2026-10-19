#!/usr/bin/env node
const [command = 'start'] = process.argv.slice(2);
const targets = { start: 'start', setup: 'setup', doctor: 'doctor', uninstall: 'uninstall', mcp: 'nexus-mcp' };
if (!targets[command]) {
  console.error('Uso: nexus-desk start|setup|doctor|uninstall|mcp'); process.exitCode = 1;
} else {
  process.argv.splice(2, 1);
  await import(new URL(`../scripts/${targets[command]}.mjs`, import.meta.url));
}
