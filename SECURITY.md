# Segurança

O Nexus Desk é uma aplicação local em prévia alpha. O servidor HTTP deve permanecer ligado ao loopback (`127.0.0.1`); não configure proxy, túnel ou encaminhamento de porta para torná-lo acessível pela rede. O token local protege rotas de escrita contra requisições não autorizadas pelo navegador, mas não autentica pessoas nem transforma o Nexus em serviço seguro para acesso remoto.

Configurações de clientes e hooks dão ao aplicativo de origem instruções para enviar eventos ao Nexus. Revise o que instala e aprove permissões no próprio cliente quando solicitado. O Nexus não executa conteúdo recebido como comandos de shell.

Para relatar uma vulnerabilidade, não abra uma issue pública com detalhes que facilitem exploração. Use os recursos privados de contato de segurança disponíveis no GitHub para este repositório. Inclua passos de reprodução mínimos, versão afetada e impacto; não envie dados pessoais ou segredos.
