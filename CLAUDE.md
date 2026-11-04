# Bybus Gestão — instruções do projeto

Sistema gerencial da **By Bus Turismo** (Florianópolis e Balneário Camboriú/SC): web (computador) + app (Android/iOS), com login, MFA, perfis de acesso e auditoria. Idioma do projeto, da interface e da documentação: **português do Brasil**.

## Leia primeiro
- `docs/conhecimento/` — base de conhecimento da empresa (fonte de verdade sobre o negócio):
  `empresa.md`, `marca.md`, `frota.md`, `produtos-e-site.md`, `canais-e-integracoes.md`, `juridico-regulatorio.md`, `financeiro.md`, `google-drive.md`, `perguntas-abertas.md`.
- `docs/produto/visao-e-modulos.md` — módulos, fases, perfis e ambientes.
- `docs/PROMPT_INICIAL.md` — prompt padrão para iniciar sessões de trabalho.
- `docs/time/README.md` — time de agentes especialistas (`.claude/agents/`).

## Regras
1. **Pergunte ao dono antes** de decisões de negócio, custos recorrentes, ações irreversíveis ou externas (Google Drive, Paytour, e-mail, publicação).
2. **LGPD:** nenhum dado pessoal real no repositório, no ambiente de testes, na demonstração publicada ou em relatórios/conversas. Use dados fictícios. Única exceção (autorizada pelo dono em 04/11/2026, ADR 0006): o banco **temporário de desenvolvimento** da sessão pode receber dados reais da Paytour com `DADOS_REAIS_AUTORIZADOS=true` — nunca exportados, versionados ou exibidos; nas respostas, só números agregados.
3. Segredos só em variáveis de ambiente/cofre; `.env` nunca é versionado.
4. Decisões técnicas relevantes viram ADR em `docs/arquitetura/adr/`.
5. Regras de negócio no back-end; dinheiro em centavos; datas UTC no banco, America/Sao_Paulo na tela.
6. Ambientes: desenvolvimento → testes/homologação (dados fictícios) → produção (só com aprovação).
7. Fatos não confirmados são marcados "a confirmar" — nunca inventar.
8. Ao aprender algo novo sobre o negócio, atualize o arquivo correspondente em `docs/conhecimento/`.

## Estado atual (04/11/2026)
- Stack: monorepo pnpm — `packages/core` (regras puras), `apps/api` (Fastify + Drizzle + PostgreSQL), `apps/web` (React). Pacote de implantação em `implantacao/` (Docker + Caddy), hospedagem ainda a contratar.
- Pronto no desenvolvimento: acesso (login, MFA, perfis, praças, auditoria), saídas e lista de passageiros, importação Paytour (API), Viator/Bókun e Decolar (e-mail), escala de guias, link de embarque, conferência, fechamento das 21h e mensagens (WhatsApp simulado), financeiro, frota, marketing, biblioteca e gestores de IA (desligados sem chave). Resumo e pendências em `docs/produto/plano-fase-2.md` (seção 6).
- Migrações: `pnpm --filter @bybus/api db:generate <nome>`. Testes da API com banco próprio quando houver outras sessões: `DATABASE_URL_TESTE`.
- Decisões do dono pendentes: provedor de WhatsApp, API do Khronos, coordenadas oficiais dos pontos, textos oficiais das mensagens, custo da IA, permissões dos perfis padrão nos módulos novos, hospedagem.
