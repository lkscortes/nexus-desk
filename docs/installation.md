# Instalação e integração

## Requisitos

- Node.js 24 ou mais recente.
- Windows é o primeiro sistema homologado. macOS e Linux são experimentais nesta alpha.
- Para eventos reais: Codex ou Claude Code instalados, autenticados e configurados no próprio aplicativo.
- Navegador moderno baseado em Chromium, como Chrome ou Edge.

Não há pacote npm publicado nem comando `npx` nesta release. Use o ZIP da release ou clone o repositório GitHub `https://github.com/lkscortes/nexus-desk`.

## Windows

Baixe e extraia o ZIP, entre na pasta e execute `Instalar Nexus.cmd`. Alternativamente, no PowerShell:

```powershell
powershell -NoProfile -File .\install.ps1 -Start
```

O bootstrap verifica o Node.js e oferece instalar a distribuição oficial via `winget` caso necessário. Depois, o setup pergunta se deseja configurar Codex, Claude Code, ambos ou nenhum. A seleção é gravada no perfil do usuário e vale para chats e projetos novos; não é necessário adicionar arquivos de integração a cada projeto. As configurações anteriores são preservadas quando possível e backups locais são criados antes de alterações. Ao concluir, o arquivo `.cmd` abre o painel e mantém o servidor no terminal. O comando PowerShell sem `-Start` faz somente a configuração. Não há dependências npm de runtime para baixar.

Se Node.js 24+ já está instalado, execute:

```sh
npm run setup
```

Para automação sem prompts:

```sh
npm run setup -- --clients both --yes
```

`--clients` aceita `codex`, `claude`, `both` ou `none`. Se escolher `none`, a integração não será instalada.

## macOS e Linux (experimental)

Instale Node.js 24+ e execute `sh ./install.sh`. Depois, execute `npm start`. O bootstrap Unix verifica o Node disponível; a instalação do Node é feita pelo usuário. A homologação do aplicativo e dos clientes nesses sistemas ainda está pendente.

## Iniciar o painel

```sh
npm start
```

O navegador abre no endereço local exibido. Mantenha a janela de terminal visível. Encerrar o terminal encerra o servidor. A porta padrão é 4318; o endereço só escuta em `127.0.0.1`.

Após configurar um cliente, recarregue-o ou abra uma conversa nova. Aprove ou habilite hooks se o cliente solicitar. O comportamento das instruções do MCP pode depender da versão e das regras de confiança do cliente. A presença do MCP não garante eventos em toda conversa: verifique com uma instrução real, não apenas com um chat vazio.

## Diagnóstico e remoção

```sh
npm run doctor
npm run uninstall
```

O diagnóstico informa o estado conhecido das configurações locais. Remover a integração desfaz os registros Nexus instalados; dados locais do painel podem permanecer e podem ser removidos à parte após fechar o servidor.

Para informações de dados, consulte [privacidade](privacy.md). Para erros comuns, consulte [solução de problemas](troubleshooting.md).
