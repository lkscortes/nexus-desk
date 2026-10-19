# Contribuir

Obrigado por ajudar a melhorar o Nexus Desk. Issues e pull requests devem descrever comportamento reproduzível, cliente e versão usados, sistema operacional e passos para reproduzir. Remova nomes, IDs de conversa, tokens, prompts e dados pessoais antes de compartilhar logs ou capturas.

## Desenvolvimento local

Use Node.js 24 ou mais recente. Clone o repositório e, na pasta raiz:

```sh
npm run check
npm test
npm start
```

O servidor é local e abre no navegador. A demonstração não exige credenciais de IA. Não inclua dados de `.local/`, configurações pessoais, filas, tokens ou backups em commits. Não use uma conversa real para validar mudanças se testes isolados forem suficientes.

## Pull requests

Mantenha cada alteração focada, explique o comportamento visível e liste os comandos de validação executados. Atualize a documentação quando mudar instalação, integração, armazenamento ou compatibilidade. Não declare suporte para cliente ou plataforma sem validação correspondente. Para mudança de segurança, siga [SECURITY.md](SECURITY.md) em vez de publicar detalhes exploráveis numa issue.
