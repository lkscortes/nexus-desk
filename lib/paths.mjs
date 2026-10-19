import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export function dataDirArgument(argv = process.argv.slice(2)) {
  const at = argv.indexOf('--data-dir');
  if (at >= 0) {
    if (!argv[at + 1] || argv[at + 1].startsWith('--')) throw new Error('--data-dir precisa de uma pasta.');
    return argv[at + 1];
  }
}
// Keep existing installations intact. Fresh distributions store mutable state
// outside the checkout, so updates or a read-only package do not lose data.
export function resolveDataDir({ env = process.env, root = projectRoot, home = homedir(), platform = process.platform, argv = process.argv.slice(2) } = {}) {
  const argument = dataDirArgument(argv);
  if (argument || env.NEXUS_DATA_DIR) return resolve(argument || env.NEXUS_DATA_DIR);
  if (env.NEXUS_BRIDGE_FILE) return dirname(resolve(env.NEXUS_BRIDGE_FILE));
  const legacy = join(root, '.local');
  if (['bridge.json', 'config.json', 'observation.json'].some(name => existsSync(join(legacy, name)))) return legacy;
  if (platform === 'win32') return resolve(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'NexusDesk');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'NexusDesk');
  return resolve(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'nexus-desk');
}
export const resolveBridgeFile = options => join(resolveDataDir(options), 'bridge.json');
