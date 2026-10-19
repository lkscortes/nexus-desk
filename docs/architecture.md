# Arquitetura e compatibilidade

O Nexus Desk é um painel local em Node.js e JavaScript. Um servidor HTTP atende a interface e a API local em loopback; atualizações do painel usam Server-Sent Events. Os dados de configuração e eventos são gravados na pasta local do usuário. Não há banco de dados externo nem serviço em nuvem.

As integrações usam MCP local por stdio e hooks de ciclo de vida suportados pelos clientes. O servidor MCP oferece ferramentas de registro da conversa, publicação de plano, leitura do quadro e eventos reais de delegação/encerramento. Ele transmite metadados ao painel; não inicia agentes, não executa prompts, não oferece transporte MCP remoto e não substitui o cliente que executa o trabalho.

## Limites

- Eventos dependem do cliente carregar a integração e permitir hooks/instruções. Confirme no cliente e faça uma atividade real para validar.
- Um chat sem mensagem real não cria atividade. Identificadores de conversa vêm do cliente; não são inferidos de títulos.
- A cobertura varia por versão, configuração e tipo de conversa. Worktrees, execução remota e ambientes isolados precisam de validação própria.
- O quadro representa os eventos recebidos. Ausência de evento não prova que nada aconteceu; animação não prova conclusão.
- O acompanhamento automático de planos do Codex é limitado às ferramentas e eventos suportados pelo cliente. TaskCreate/TaskUpdate e TodoWrite não são intercambiáveis; não assuma que todos atualizam o quadro.
- Windows é o alvo homologado primeiro. macOS e Linux são experimentais até validação específica.
- Chrome e Edge modernos são os navegadores visados; outros navegadores não são homologados nesta alpha.

## Fluxo

1. O setup registra a integração escolhida no perfil do usuário.
2. O aplicativo de origem carrega a configuração e envia eventos reais ao processo local.
3. O servidor valida e guarda os metadados localmente e atualiza a interface.
4. O terminal do Nexus controla a vida do servidor. Fechá-lo interrompe o painel e a recepção de novos eventos.

O token obtido em `/api/session` é um mecanismo local de proteção de escrita. Não é uma credencial de usuário ou autorização para acesso remoto. Consulte [privacidade e armazenamento](privacy.md).
