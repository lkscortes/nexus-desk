# Nexus Desk

Um painel local para acompanhar atividade de conversas e agentes de programação do Codex e Claude Code. Veja tarefas e delegações reais num quadro visual, com mascotes animadas. O Nexus observa o trabalho; a conversa e a execução continuam no aplicativo de origem.

**v0.2.0-alpha.1 · prévia pública.** Windows é a plataforma homologada primeiro. macOS e Linux são experimentais. A integração depende do cliente carregar e permitir as instruções e hooks configurados. O painel não garante observar todos os chats nem comprova conclusão apenas pela animação.

## Instalação rápida (Windows)

1. Baixe o ZIP desta release ou clone `https://github.com/lkscortes/nexus-desk`.
2. Extraia o ZIP, se aplicável, e abra a pasta `nexus-desk`.
3. Execute `Instalar Nexus.cmd` ou, no PowerShell:

   ```powershell
   powershell -NoProfile -File .\install.ps1 -Start
   ```

O instalador verifica o Node.js 24 ou mais recente e oferece instalar a versão oficial com `winget` quando necessário. Depois de configurar, abre o painel e mantém o terminal visível. Se já tiver Node, também pode executar `npm run setup` e depois `npm start`. Não há dependências npm de runtime para baixar. O setup apresenta Codex, Claude Code, ambos ou nenhum; a configuração escolhida é aplicada ao perfil do usuário uma vez, inclusive para novos projetos e chats. Recarregue o cliente e aprove hooks quando o aplicativo solicitar.

Para setup sem interação:

```sh
npm run setup -- --clients both --yes
```

Escolha `codex`, `claude`, `both` ou `none` em `--clients`. `none` deixa a integração desativada. O setup não executa IA.

## Iniciar

```sh
npm start
```

O servidor local abre o navegador. Mantenha o terminal visível enquanto usar o Nexus; fechá-lo encerra o servidor. A porta padrão é 4318 e o endereço é ligado apenas a `127.0.0.1`. A demonstração funciona sem conta de IA. Para acompanhar trabalho real, use seu próprio cliente e sua conta; os custos e limites dependem desse serviço.

Diagnóstico e remoção da integração:

```sh
npm run doctor
npm run uninstall
```

## O que esperar

O Nexus recebe metadados de atividade e tarefas suportados. A primeira instrução real cria o registro do chat; um chat vazio não gera atividade. A disponibilidade de eventos varia por cliente, versão e configuração de confiança. Confira `npm run doctor` e [instalação e integração](docs/installation.md) se algo não aparecer.

O Nexus é um servidor MCP local por stdio com ferramentas de registro e acompanhamento. Ele não hospeda modelos, não inicia execução de IA, não é um serviço remoto e não substitui as aprovações do aplicativo de origem. O quadro pode refletir planos publicados e eventos observados. Recursos nativos específicos do Codex ou Claude podem ter limites; veja [arquitetura e compatibilidade](docs/architecture.md).

## Dados e segurança

As configurações, eventos locais, fila e token ficam na pasta de dados local do usuário. O Nexus não usa banco ou servidor em nuvem. A porta HTTP 4318 atende somente loopback; não a exponha na rede. O token de `/api/session` é uma proteção local contra requisições cruzadas, não uma conta ou credencial para compartilhar. Consulte [privacidade](docs/privacy.md).

## Documentação

- [Instalação, setup e remoção](docs/installation.md)
- [Arquitetura e compatibilidade](docs/architecture.md)
- [Privacidade e dados locais](docs/privacy.md)
- [Solução de problemas](docs/troubleshooting.md)
- [Assets e proveniência](docs/assets.md)
- [Histórico de versões](CHANGELOG.md)
- [Contribuição](CONTRIBUTING.md)
- [Segurança](SECURITY.md)

## Desenvolvimento

Requer Node.js 24 ou mais recente. O aplicativo não exige dependências npm de runtime. Comandos para desenvolvimento:

```sh
npm run check
npm test
```

## Roadmap

- [ ] Homologar o primeiro turno de um chat e projeto novos nos aplicativos Codex e Claude Code, sem edição manual de arquivos.
- [ ] Ampliar testes práticos em outros computadores e sistemas operacionais.
- [ ] Adicionar variações de expressão facial às skins.

## Licença

Código sob licença [MIT](LICENSE). As imagens originais das mascotes estão descritas em [docs/assets.md](docs/assets.md).
