import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setup, doctor, uninstall, resolveSetupOptions, requireNode, projectRoot } from '../lib/setup.mjs';
import { createDeskServer } from '../server.mjs';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const temporary = async t => {
  await mkdir(resolve(projectRoot, 'work'), { recursive: true });
  const path = await mkdtemp(resolve(projectRoot, 'work', 'nexus-setup-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
};
const argsFor = home => ({ home, dataDir: resolve(home, 'shared data'), clients: 'both' });
const filesFor = home => ['.codex/config.toml', '.codex/AGENTS.md', '.codex/hooks.json', '.claude/settings.json', '.claude/CLAUDE.md', '.claude.json'].map(file => resolve(home, file));
async function allFiles(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) result.push(...(entry.isDirectory() ? await allFiles(resolve(folder, entry.name)) : [resolve(folder, entry.name)]));
  return result.sort();
}
const cli = args => new Promise((done, fail) => {
  const child = spawn(process.execPath, [resolve(projectRoot, 'scripts/setup.mjs'), ...args], { cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', fail); child.on('exit', code => done({ code, stdout, stderr }));
});

test('Node 24 requirement and explicit isolated home ignore live client profiles', () => {
  assert.throws(() => requireNode('22.18.0'), /Node.js 24/);
  assert.doesNotThrow(() => requireNode('24.0.0'));
  const home = resolve(tmpdir(), 'profile-only');
  const options = resolveSetupOptions({ home, env: { CODEX_HOME: 'C:/LIVE-CODEX', CLAUDE_CONFIG_DIR: 'C:/LIVE-CLAUDE', NEXUS_DATA_DIR: 'C:/LIVE-DATA' }, yes: true });
  assert.equal(options.codexHome, resolve(home, '.codex'));
  assert.equal(options.claudeHome, resolve(home, '.claude'));
  assert.equal(options.claudeConfig, resolve(home, '.claude.json'));
  assert.equal(options.dataDir, resolve(home, '.nexus-desk'));
  assert.equal(options.clients, 'both');
  const custom = resolveSetupOptions({ env: { CLAUDE_CONFIG_DIR: resolve(home, 'custom') } });
  assert.equal(custom.claudeConfig, resolve(home, 'custom', '.claude.json'));
});

test('fresh setup configures both users globally, shares data, and requires no project files', async t => {
  const home = await temporary(t), options = argsFor(home);
  const result = await setup(options);
  assert.equal(result.scope, 'user'); assert.deepEqual(result.clients, ['codex', 'claude']);
  assert.equal(result.changed.length, 6);
  const hooks = await readJson(resolve(home, '.codex/hooks.json'));
  const settings = await readJson(resolve(home, '.claude/settings.json'));
  for (const config of [hooks, settings]) {
    assert.ok(config.hooks.SessionStart.length);
    for (const group of config.hooks.SessionStart) for (const hook of group.hooks) {
      assert.ok(hook.command.includes('--data-dir'));
      assert.ok(hook.command.includes(options.dataDir.replaceAll('\\', '/')));
    }
  }
  const mcp = await readJson(resolve(home, '.claude.json'));
  assert.equal(mcp.mcpServers.nexus.command, process.execPath);
  assert.equal(mcp.mcpServers.nexus.env.NEXUS_PROVIDER, 'claude');
  assert.equal(mcp.mcpServers.nexus.env.NEXUS_DATA_DIR, options.dataDir);
  assert.match(await readFile(resolve(home, '.codex/config.toml'), 'utf8'), /NEXUS_PROVIDER = "codex"/);
  assert.match(await readFile(resolve(home, '.claude/CLAUDE.md'), 'utf8'), /ID real da conversa informado pelo hook/);
  const project = resolve(home, 'a-new-project'); await mkdir(project);
  assert.deepEqual(await readdir(project), []);
  const diagnostics = await doctor(options);
  assert.deepEqual(diagnostics.configs, { codex: { mcp: true, hooks: true, instructions: true }, claude: { mcp: true, hooks: true, instructions: true } });
});

test('setup preserves models, permissions, trust, unrelated MCP and mixed hook groups; repeated setup does not write', async t => {
  const home = await temporary(t), options = argsFor(home);
  await mkdir(resolve(home, '.codex')); await mkdir(resolve(home, '.claude'));
  const codex = 'model = "keep-model"\n[projects."safe-project"]\ntrust_level = "untrusted"\n[mcp_servers.other]\ncommand = "keep-command"\n';
  const settings = { model: 'keep-claude-model', permissions: { deny: ['Bash(rm *)'] }, hooks: { Stop: [{ matcher: '*', timeout: 17, hooks: [{ type: 'command', command: 'my-other-hook' }] }] } };
  const mcp = { oauthAccount: { token: 'TEST_PRIVATE_TOKEN' }, projects: { 'test-project': { hasTrustDialogAccepted: false } }, mcpServers: { other: { command: 'keep-server' } } };
  await writeFile(resolve(home, '.codex/config.toml'), codex);
  await writeFile(resolve(home, '.codex/AGENTS.md'), 'Keep Codex instructions.\n');
  await writeFile(resolve(home, '.claude/settings.json'), JSON.stringify(settings));
  await writeFile(resolve(home, '.claude.json'), JSON.stringify(mcp));
  await writeFile(resolve(home, '.claude/CLAUDE.md'), 'Keep Claude instructions.\n');
  await setup(options);
  const saved = await readJson(resolve(home, '.claude/settings.json'));
  assert.equal(saved.model, settings.model); assert.deepEqual(saved.permissions, settings.permissions);
  assert.deepEqual(saved.hooks.Stop[0], settings.hooks.Stop[0]);
  const global = await readJson(resolve(home, '.claude.json'));
  assert.deepEqual(global.oauthAccount, mcp.oauthAccount); assert.deepEqual(global.projects, mcp.projects); assert.deepEqual(global.mcpServers.other, mcp.mcpServers.other);
  assert.ok((await readFile(resolve(home, '.codex/config.toml'), 'utf8')).startsWith(codex.trimEnd()));
  const before = await Promise.all(filesFor(home).map(path => readFile(path, 'utf8')));
  const backupsBefore = await allFiles(resolve(options.dataDir, 'backups'));
  const mtimes = await Promise.all(filesFor(home).map(async path => (await stat(path)).mtimeMs));
  const result = await setup(options);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(await Promise.all(filesFor(home).map(path => readFile(path, 'utf8'))), before);
  assert.deepEqual(await Promise.all(filesFor(home).map(async path => (await stat(path)).mtimeMs)), mtimes);
  assert.deepEqual(await allFiles(resolve(options.dataDir, 'backups')), backupsBefore);
  const backups = await Promise.all(backupsBefore.map(path => readFile(path, 'utf8')));
  assert.ok(backups.some(text => text === JSON.stringify(mcp)));
});

test('invalid JSON or hook schema aborts before changing any selected client', async t => {
  for (const invalid of ['{broken', '{"hooks":{"Stop":{}}}', '[]']) {
    const home = await temporary(t), options = argsFor(home);
    await mkdir(resolve(home, '.claude')); await mkdir(resolve(home, '.codex'));
    const config = 'model = "untouched"\n';
    await writeFile(resolve(home, '.codex/config.toml'), config);
    await writeFile(resolve(home, '.claude/settings.json'), invalid);
    await assert.rejects(setup(options), /inválid|Objeto JSON/);
    assert.equal(await readFile(resolve(home, '.codex/config.toml'), 'utf8'), config);
    assert.equal(await readFile(resolve(home, '.claude/settings.json'), 'utf8'), invalid);
    await assert.rejects(stat(resolve(home, '.codex/hooks.json')), { code: 'ENOENT' });
  }
});

test('a different Nexus MCP is preserved instead of replaced', async t => {
  const home = await temporary(t), options = argsFor(home), original = JSON.stringify({ mcpServers: { nexus: { command: 'someone-elses-server' } } });
  await writeFile(resolve(home, '.claude.json'), original);
  await assert.rejects(setup(options), /outro MCP chamado nexus/);
  assert.equal(await readFile(resolve(home, '.claude.json'), 'utf8'), original);
  await assert.rejects(stat(resolve(home, '.codex/config.toml')), { code: 'ENOENT' });
});

test('rerunning setup after moving the package repairs only roots owned by the same profile manifest', async t => {
  const home = await temporary(t), options = argsFor(home), previousRoot = resolve(home, 'old-package');
  await setup(options);
  const manifestPath = resolve(options.dataDir, 'setup-manifest.json'), manifest = await readJson(manifestPath);
  for (const profile of manifest.profiles) { profile.root = previousRoot; profile.roots = [previousRoot]; }
  await writeFile(manifestPath, JSON.stringify(manifest));
  const configPath = resolve(home, '.codex/config.toml');
  const config = (await readFile(configPath, 'utf8')).replace(JSON.stringify(resolve(projectRoot, 'scripts/nexus-mcp.mjs')), JSON.stringify(resolve(previousRoot, 'scripts/nexus-mcp.mjs')));
  await writeFile(configPath, config);
  for (const [client, path] of [['codex', resolve(home, '.codex/hooks.json')], ['claude', resolve(home, '.claude/settings.json')]]) {
    const hooks = await readJson(path);
    for (const groups of Object.values(hooks.hooks)) for (const group of groups) for (const hook of group.hooks) hook.command = hook.command.replace(projectRoot.replaceAll('\\', '/'), previousRoot.replaceAll('\\', '/'));
    hooks.hooks.Stop[0].hooks.push({ type: 'command', command: 'unrelated-kept' });
    await writeFile(path, JSON.stringify(hooks));
  }
  const mcpPath = resolve(home, '.claude.json'), mcp = await readJson(mcpPath);
  mcp.mcpServers.nexus.args = [resolve(previousRoot, 'scripts/nexus-mcp.mjs')]; await writeFile(mcpPath, JSON.stringify(mcp));
  const repaired = await setup(options); assert.ok(repaired.changed.length >= 4);
  for (const [client, path] of [['codex', resolve(home, '.codex/hooks.json')], ['claude', resolve(home, '.claude/settings.json')]]) {
    const hooks = await readJson(path), commands = Object.values(hooks.hooks).flatMap(groups => groups.flatMap(group => group.hooks.map(hook => hook.command)));
    assert.ok(!commands.some(command => command.includes(previousRoot.replaceAll('\\', '/'))));
    assert.ok(commands.some(command => command.includes('unrelated-kept')));
    assert.equal(commands.filter(command => command.includes(`${client}-hook.mjs`)).length, Object.keys(hooks.hooks).length);
  }
  assert.equal((await readJson(mcpPath)).mcpServers.nexus.args[0], resolve(projectRoot, 'scripts/nexus-mcp.mjs'));
  assert.ok((await readFile(configPath, 'utf8')).includes(JSON.stringify(resolve(projectRoot, 'scripts/nexus-mcp.mjs'))));
  assert.deepEqual((await setup(options)).changed, []);
  const updatedManifest = await readJson(manifestPath);
  assert.ok(updatedManifest.profiles.every(profile => profile.roots.includes(previousRoot) && profile.roots.includes(projectRoot)));
});

test('uninstall removes only Nexus integrations, preserves data and other hook commands, and is idempotent', async t => {
  const home = await temporary(t), options = argsFor(home);
  await setup(options);
  for (const path of [resolve(home, '.claude/settings.json'), resolve(home, '.codex/hooks.json')]) {
    const config = await readJson(path); config.permissions = { deny: ['PrivateRead'] }; config.hooks.Stop[0].hooks.push({ type: 'command', command: 'unrelated-command' });
    await writeFile(path, JSON.stringify(config));
  }
  const configPath = resolve(home, '.codex/config.toml');
  await writeFile(configPath, (await readFile(configPath, 'utf8')) + '\n[mcp_servers.another]\ncommand = "keep"\n');
  const mcpPath = resolve(home, '.claude.json'), mcp = await readJson(mcpPath); mcp.mcpServers.another = { command: 'keep' }; mcp.projects = { arbitrary: { trusted: false } }; await writeFile(mcpPath, JSON.stringify(mcp));
  await writeFile(resolve(options.dataDir, 'config.json'), '{"keep":"data"}');
  const result = await uninstall(options); assert.equal(result.dataPreserved, true);
  for (const path of [resolve(home, '.claude/settings.json'), resolve(home, '.codex/hooks.json')]) {
    const config = await readJson(path); assert.deepEqual(config.permissions, { deny: ['PrivateRead'] });
    assert.equal(config.hooks.Stop.length, 1); assert.equal(config.hooks.Stop[0].hooks[0].command, 'unrelated-command');
    assert.ok(!JSON.stringify(config).includes('-hook.mjs'));
  }
  assert.ok(!(await readFile(configPath, 'utf8')).includes('[mcp_servers.nexus]'));
  assert.match(await readFile(configPath, 'utf8'), /mcp_servers.another/);
  assert.equal((await readJson(mcpPath)).mcpServers.another.command, 'keep');
  assert.deepEqual((await readJson(mcpPath)).projects, mcp.projects);
  assert.equal(await readFile(resolve(options.dataDir, 'config.json'), 'utf8'), '{"keep":"data"}');
  assert.deepEqual((await uninstall(options)).changed, []);
});

test('doctor handles offline and online bridges, queued events and redacts private metadata', async t => {
  const home = await temporary(t), options = argsFor(home);
  await mkdir(resolve(options.dataDir, 'inbox'), { recursive: true });
  await writeFile(resolve(options.dataDir, 'inbox/event.json'), JSON.stringify({ transcript: 'TEST_PRIVATE_TRANSCRIPT' }));
  await writeFile(resolve(options.dataDir, 'bridge.json'), JSON.stringify({ origin: 'http://127.0.0.1:1', token: 'TEST_PRIVATE_TOKEN' }));
  await writeFile(resolve(options.dataDir, 'observation.json'), JSON.stringify({ agents: { x: { provider: 'claude', status: 'idle', timestamp: '2026-10-19T12:00:00.000Z', tokens: 73, message: 'TEST_PRIVATE_MESSAGE' } } }));
  const offline = await doctor(options);
  assert.equal(offline.bridge.status, 'offline'); assert.equal(offline.queued, 1); assert.equal(offline.recentEvents.length, 1);
  assert.ok(!JSON.stringify(offline).includes('TEST_PRIVATE')); assert.ok(!JSON.stringify(offline).includes('tokens'));
  const desk = await createDeskServer({ port: 0, dataDir: options.dataDir }); t.after(() => desk.close());
  const online = await doctor(options); assert.equal(online.bridge.status, 'online'); assert.equal(online.bridge.origin, desk.origin);
  assert.ok(!JSON.stringify(online).includes('TEST_PRIVATE'));
});

test('CLI requires an explicit choice without a TTY and --yes configures only the isolated home', async t => {
  const home = await temporary(t);
  const empty = await cli(['--home', home]); assert.equal(empty.code, 1); assert.match(empty.stderr, /Sem terminal interativo/); assert.deepEqual(await readdir(home), []);
  const result = await cli(['--home', home, '--yes', '--json']);
  assert.equal(result.code, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).clients, ['codex', 'claude']);
});

test('Windows bootstrap forwards flags to the isolated profile without installing dependencies', { skip: process.platform !== 'win32' }, async t => {
  const home = await temporary(t);
  const result = await new Promise((done, fail) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve(projectRoot, 'install.ps1'), '--home', home, '--clients', 'none', '--json'], { cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', fail); child.on('exit', code => done({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim()); assert.deepEqual(output.clients, []); assert.equal(output.home, home);
  await assert.rejects(stat(resolve(home, '.codex')), { code: 'ENOENT' }); await assert.rejects(stat(resolve(home, '.claude')), { code: 'ENOENT' });
});
