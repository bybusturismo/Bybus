# Bybus Gestão — instruções do projeto

Sistema gerencial da **By Bus Turismo** (Florianópolis e Balneário Camboriú/SC): web (computador) + app (Android/iOS), com login, MFA, perfis de acesso e auditoria. Idioma do projeto, da interface e da documentação: **português do Brasil**.

## Leia primeiro
- `docs/conhecimento/` — base de conhecimento da empresa (fonte de verdade sobre o negócio):
  `empresa.md`, `frota.md`, `produtos-e-site.md`, `canais-e-integracoes.md`, `juridico-regulatorio.md`, `financeiro.md`, `google-drive.md`, `perguntas-abertas.md`.
- `docs/produto/visao-e-modulos.md` — módulos, fases, perfis e ambientes.
- `docs/PROMPT_INICIAL.md` — prompt padrão para iniciar sessões de trabalho.
- `docs/time/README.md` — time de agentes especialistas (`.claude/agents/`).

## Regras
1. **Pergunte ao dono antes** de decisões de negócio, custos recorrentes, ações irreversíveis ou externas (Google Drive, Paytour, e-mail, publicação).
2. **LGPD:** nenhum dado pessoal real no repositório, no ambiente de testes ou em relatórios. Use dados fictícios.
3. Segredos só em variáveis de ambiente/cofre; `.env` nunca é versionado.
4. Decisões técnicas relevantes viram ADR em `docs/arquitetura/adr/`.
5. Regras de negócio no back-end; dinheiro em centavos; datas UTC no banco, America/Sao_Paulo na tela.
6. Ambientes: desenvolvimento → testes/homologação (dados fictícios) → produção (só com aprovação).
7. Fatos não confirmados são marcados "a confirmar" — nunca inventar.
8. Ao aprender algo novo sobre o negócio, atualize o arquivo correspondente em `docs/conhecimento/`.

## Estado atual (22/10/2026)
- Fase de descoberta concluída (Drive, buscas públicas, regulação). Site oficial ainda não lido integralmente (rede bloqueada).
- Decisões: integrar Paytour (ADR 0001); primeira entrega no ambiente de testes = **Acesso + Frota**. Orçamento de hospedagem sem preferência — comparar provedores antes de contratar. Stack ainda a definir (próximo ADR).
