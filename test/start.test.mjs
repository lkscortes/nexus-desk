import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeskServer } from '../server.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const launcher = join(root, 'scripts', 'start.mjs');

async function freePort() {
  const probe = await createDeskServer({ port: 0, persist: false });
  const port = probe.server.address().port;
  await probe.close();
  return port;
}

async function waitFor(predicate, child, output) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await predicate()) return;
    if (child.exitCode !== null) throw new Error(`Launcher exited early (${child.exitCode}): ${output()}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for launcher: ${output()}`);
}

function launch(port, dataDir) {
  const child = spawn(process.execPath, [launcher, '--no-browser'], {
    cwd: root,
    env: { ...process.env, NEXUS_PORT: String(port), NEXUS_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { text += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { text += chunk; });
  return { child, output: () => text };
}

test('launcher remains in foreground and releases its listener when stopped', async () => {
  const port = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'nexus-launcher-'));
  const { child, output } = launch(port, dataDir);
  try {
    await waitFor(async () => output().includes('Demonstração pronta.'), child, output);
    assert.equal(child.exitCode, null, 'launcher must stay alive while its server is serving');
    child.kill(process.platform === 'win32' ? 'SIGTERM' : 'SIGINT');
    await waitFor(async () => child.exitCode !== null || child.signalCode !== null, child, output);
    const rebound = await createDeskServer({ port, persist: false });
    await rebound.close();
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('occupied port reports that this window does not control the existing server', async () => {
  const existing = await createDeskServer({ port: 0, persist: false });
  const port = existing.server.address().port;
  const dataDir = await mkdtemp(join(tmpdir(), 'nexus-launcher-busy-'));
  const { child, output } = launch(port, dataDir);
  try {
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Launcher did not exit: ${output()}`)), 5000);
      child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    assert.equal(exit.code, 1, output());
    assert.match(output(), /não controla|nao controla/i);
    assert.equal(existing.server.listening, true, 'the pre-existing server must remain alive');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await existing.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
