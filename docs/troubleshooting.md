# Solução de problemas

## O navegador não abriu

Mantenha o terminal aberto e abra o endereço `http://127.0.0.1:4318` mostrado ali. Se a porta estiver ocupada, o Nexus informa o conflito. Fechar o terminal encerra o servidor.

## O painel abre, mas não mostra atividade real

Execute `npm run doctor` e confirme que o cliente desejado está configurado. Recarregue o Codex ou Claude Code e abra uma conversa nova com uma instrução real. Um chat vazio não produz eventos. Confirme no cliente que a integração carregou e aprove hooks quando solicitados.

A alpha depende das versões e configurações de confiança do cliente. Worktrees ou execução remota podem não alcançar esta instância local. A ausência de eventos não indica que o cliente não trabalhou.

## Um plano ou delegação não aparece

O Nexus só pode mostrar eventos que o cliente enviou e que foram aceitos. Verifique o quadro na conversa correta e compare o tipo de evento com os limites em [arquitetura](architecture.md). Recursos nativos de tarefas variam entre Codex e Claude Code.

## Doctor relata configuração ausente ou inválida

Execute `npm run setup` novamente e selecione o cliente correto. Se existir uma configuração concorrente com o mesmo nome, revise-a antes de alterar manualmente. O setup cria backups locais; não publique esses arquivos.

## Quero desfazer a integração

Execute `npm run uninstall`. Isso remove as entradas gerenciadas pelo Nexus. Feche o painel antes de limpar dados locais. Veja [privacidade](privacy.md) para entender o que pode permanecer.

Ao abrir uma issue, inclua sistema operacional, versão do Node e do cliente, comandos executados e passos de reprodução. Remova tokens, IDs de conversa, nomes privados, prompts e saídas antes de compartilhar.
