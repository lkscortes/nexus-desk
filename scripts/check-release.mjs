import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (!Array.isArray(pkg.files) || !pkg.files.length) throw new Error('A release exige allowlist em package.json.');
const files = ['package.json'];
async function visit(path) {
  const entries = await readdir(resolve(root, path), { withFileTypes: true });
  for (const entry of entries) {
    const name = `${path}/${entry.name}`;
    if (entry.isDirectory()) await visit(name); else files.push(name);
  }
}
for (const entry of pkg.files) {
  if (entry.endsWith('/')) await visit(entry.slice(0, -1)); else files.push(entry);
}
for (const name of files) {
  if (/(^|\/)(\.local|work|dist|node_modules|backups)(\/|$)|bridge\.json$|observation\.json$|\.nexus-backup-|preview\.json$/.test(name)) throw new Error(`Arquivo privado no pacote: ${name}`);
  if (!/\.(?:mjs|js|json|md|ps1|sh|cmd|yml)$|^LICENSE$/.test(name)) continue;
  const text = await readFile(resolve(root, name), 'utf8');
  if (/[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+[\\/]|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(text)) throw new Error(`Caminho pessoal ou credencial no pacote: ${name}`);
}
console.log(`Release verificada: ${files.length} arquivos permitidos, sem diretórios privados ou credenciais reconhecidas.`);
