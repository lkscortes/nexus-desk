import { createInterface } from 'node:readline/promises';
import { parseSetupArgs, setup, resolveSetupOptions, requireNode } from '../lib/setup.mjs';

try {
  requireNode();
  const options = parseSetupArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Uso: npm run setup -- [--clients codex|claude|both|none] [--yes] [--home PERFIL] [--data-dir DIR] [--json]\nConfigura o usuário atual para todos os projetos novos. --home usa uma raiz de perfil isolada.\n--yes escolhe ambos os clientes quando --clients não é informado. Não altera modelos, permissões ou confiança.');
  } else {
    if (!options.clients && !options.yes) {
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Sem terminal interativo: informe --clients codex|claude|both|none ou --yes.');
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        console.log('Nexus · instalação no escopo do usuário (todos os projetos novos).\n1. Codex\n2. Claude Code\n3. Ambos\n4. Apenas painel');
        const answer = (await prompt.question('Escolha [3]: ')).trim();
        options.clients = ({ '': 'both', '1': 'codex', '2': 'claude', '3': 'both', '4': 'none', codex: 'codex', claude: 'claude', both: 'both', none: 'none' })[answer];
        if (!options.clients) throw new Error('Escolha inválida; nenhuma configuração alterada.');
      } finally { prompt.close(); }
    }
    const target = resolveSetupOptions(options);
    if (!options.json) console.log(`Escopo: usuário · clientes: ${target.clients}\nDados e backups: ${target.dataDir}`);
    const result = await setup(options);
    if (options.json) console.log(JSON.stringify(result));
    else {
      console.log(`Instalação validada: ${result.changed.length} arquivo(s) de integração atualizado(s).`);
      console.log(result.restartRequired ? 'Reabra o cliente e inicie uma conversa nova. Confirme os avisos de confiança que o cliente apresentar.' : 'Painel pronto; nenhuma integração de cliente foi configurada.');
      console.log('Execute npm start para abrir o painel; npm run doctor mostra o diagnóstico.');
    }
  }
} catch (error) { console.error(`Nexus: ${error.message}`); process.exitCode = 1; }
