import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('installer preserves unrelated hooks and is idempotent', async () => {
  const base = fileURLToPath(new URL('../.local/', import.meta.url)); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'installer-test-')); const target = join(dir, 'hooks.json');
  const unrelated = { type: 'command', command: 'example-only-command' };
  try {
    await writeFile(target, JSON.stringify({ custom: 'preserved', hooks: { Stop: [{ hooks: [unrelated] }] } }));
    const script = fileURLToPath(new URL('../scripts/install-codex-hooks.mjs', import.meta.url));
    execFileSync(process.execPath, [script, '--target', target]);
    execFileSync(process.execPath, [script, '--target', target]);
    const saved = JSON.parse(await readFile(target, 'utf8')); assert.equal(saved.custom, 'preserved');
    assert.equal(saved.hooks.Stop.length, 2); assert.deepEqual(saved.hooks.Stop[0].hooks[0], unrelated);
    assert.equal(saved.hooks.SubagentStart.length, 1);
  } finally { assert.ok(dir.startsWith(join(base, 'installer-test-'))); await rm(dir, { recursive: true, force: true }); }
});
