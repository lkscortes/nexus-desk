import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeskServer } from '../server.mjs';
import { resolveDataDir } from '../lib/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.NEXUS_PORT || 4318);
const dataDir = resolveDataDir();
const originFor = port => `http://127.0.0.1:${port}`;

async function isNexusRunning() {
  try {
    const response = await fetch(`${originFor(port)}/api/health`, { signal: AbortSignal.timeout(500) });
    return response.ok && (await response.json()).name === 'nexus-desk';
  } catch { return false; }
}

if (await isNexusRunning()) {
  console.error(`Já existe um Nexus Desk em ${originFor(port)}. Esta janela não controla essa instância. Encerre o terminal que iniciou o servidor antes de abrir outro.`);
  process.exitCode = 1;
} else {
  await mkdir(dataDir, { recursive: true });
  let desk;
  try {
    desk = await createDeskServer({ port, dataDir });
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(`A porta ${port} já está ocupada. Esta janela não controla o processo existente. Encerre o servidor anterior ou escolha outra porta com NEXUS_PORT.`);
      process.exitCode = 1;
    } else throw error;
  }

  if (desk) {
    console.log(`Nexus Desk · Local: ${desk.origin}`);
    console.log('Demonstração pronta. Conectores disponíveis na aba Conexões. Ctrl+C encerra.');
    console.log('Mantenha este terminal aberto. Fechar esta janela encerra o Nexus.');
    if (!process.argv.includes('--no-browser')) {
      const command = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', desk.origin]] : process.platform === 'darwin' ? ['open', [desk.origin]] : ['xdg-open', [desk.origin]];
      const browser = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true });
      browser.on('error', () => console.log(`Abra ${desk.origin}`));
      browser.unref();
    }

    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      await desk.close();
      process.exit(0);
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, shutdown);
  }
}
