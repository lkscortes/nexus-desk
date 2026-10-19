# Privacidade e armazenamento

O Nexus Desk roda localmente. Esta release não envia dados para um serviço Nexus em nuvem nem usa contas Nexus. A conversa e a execução de IA permanecem no Codex ou Claude Code; o uso desses serviços segue a conta e as políticas do respectivo provedor.

O painel recebe metadados necessários à visualização, como identificadores de conversa fornecidos pelo cliente, título, estado, nomes de agentes e tarefas publicadas. Prompts completos, respostas e saídas de ferramentas não fazem parte do propósito da integração. Não publique capturas ou exportações sem revisar se contêm nomes, títulos ou detalhes pessoais.

As configurações, histórico de observação, fila pendente, token local e backups do setup são gravados na pasta de dados do usuário. A localização pode variar por sistema e instalação; `npm run doctor` ajuda a identificar o estado local. A pasta `.local/` é privada e ignorada pelo Git. Não a inclua em issues, commits ou arquivos de release.

O servidor HTTP escuta em `127.0.0.1:4318` por padrão. Isso limita o acesso à própria máquina, não à Internet ou à rede local. Não exponha a porta com proxy ou túnel. O endpoint `/api/session` entrega um token para proteção de rotas locais; esse token não é conta, login nem credencial para compartilhar.

Para remover a integração, use `npm run uninstall`. A configuração e os dados do painel podem permanecer; feche o Nexus e remova a pasta de dados local manualmente se também quiser apagar o histórico e as preferências. Mantenha qualquer backup que queira preservar antes da remoção.
