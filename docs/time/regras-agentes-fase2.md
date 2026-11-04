# Regras comuns para os agentes da Fase 2 (04/11/2026)

O dono está fora por várias horas: trabalhe **sozinho, sem perguntar**; decisões de negócio não confirmadas viram "a confirmar" na documentação. Leia antes: `CLAUDE.md`, `docs/produto/plano-fase-2.md` e os arquivos de `docs/conhecimento/` ligados ao seu módulo.

## Referência
O dono tem outro sistema pronto, o APP TOMA (JS/Express), em `/home/user/tomafelicidade` (somente leitura). Use as **ideias, regras e travas** dele (`docs/*.md` e `server/src/*.js`), adaptadas a uma empresa de turismo e à nossa stack — não copie o estilo nem a estrutura.

## Stack e convenções do Bybus
- Monorepo pnpm: `packages/core` (regras puras TS; testes vitest em `packages/core/test`), `apps/api` (Fastify 5 + Drizzle + PostgreSQL 16 + Zod; testes vitest com Postgres real `bybus_test`), `apps/web` (React 18 + Vite + react-router 6; testes vitest + testing-library em `src/**/*.test.tsx`).
- Modelos a seguir: `apps/api/src/rotas/escala.ts` e `rotas/embarque.ts` (rotas), `seguranca/escopo.ts` (`filtroUnidade`, `garantir*` — escopo por praça), `seguranca/sessao.ts` (`exigir(config, "permissao")`), `auditoria.ts` (`auditar`), `apps/web/src/paginas/Escala.tsx` (tela), `estilos/telas.css` (classes `pagina`, `pagina__cabecalho`, `filtros`, `cartao`, `tabela`, `etiqueta`, `botao`…), `componentes/Indicador.tsx`.
- Português do Brasil em código, telas e docs. Dinheiro em **centavos** (inteiro). Datas UTC no banco, America/Sao_Paulo na tela. Zod em toda entrada. Auditoria em toda ação que grava. **LGPD:** nada de dado pessoal real em código, testes ou logs (use fictícios); painéis e IA recebem só agregados.
- **Permissões novas:** em `apps/api/src/seguranca/permissoes.ts` (`CATALOGO_PERMISSOES`; sensíveis em `PERMISSOES_SENSIVEIS`), `apps/web/src/api/tipos.ts` (`PERMISSOES`) e `apps/web/src/util/rotulos.ts` (`AREAS_PERMISSAO`). ADMIN já recebe todas pelo código.
- **Banco:** tabelas num arquivo NOVO `apps/api/src/db/esquemas/<modulo>.ts` e uma linha ao FIM de `apps/api/src/db/schema.ts`: `export * from "./esquemas/<modulo>.js";`. **Não commite migrações.** Para testar: `cd apps/api && python3 /tmp/claude-0/-home-user-Bybus/d4248ef6-e619-57d5-aade-a6ad830cf672/scratchpad/drizzle_enter.py <modulo>_tmp`; antes de CADA commit: `git checkout -- drizzle && git clean -fd drizzle`. A migração única é gerada depois da junção.
- **Rotas:** `apps/api/src/rotas/<modulo>.ts` registradas em `apps/api/src/app.ts` (uma linha de import + uma `await`). Regras puras em `packages/core/src/<modulo>/*.ts` exportadas no `index.ts`, com testes. Rode `pnpm --filter @bybus/core build` antes dos testes da API.
- **Testes da API:** arquivo NOVO `apps/api/test/<modulo>.test.ts` com `beforeAll` próprio (`prepararBanco` + `subirApp` de `test/ajuda.ts`; ver o topo de `test/api.test.ts`).
- **Telas:** `apps/web/src/paginas/<modulo>/*.tsx`; rotas em `apps/web/src/App.tsx` (dentro de `<Route element={<Layout />}>`, com `<Exige permissao=…>`). Menu em `apps/web/src/componentes/Layout.tsx`: troque os itens planejados (`/em-breve/...`) do seu módulo por itens reais e remova as entradas de `MODULOS_PLANEJADOS` em `apps/web/src/paginas/EmBreve.tsx`; ajuste `componentes/Layout.test.tsx`. **Não mexa** em `apps/web/src/demo/apiFalsa.ts`.
- Visual limpo e objetivo (pedido do dono), responsivo no celular, acessível.
- **Pacotes novos:** só conhecidos, versão fixa (sem `^`), lançados há mais de 2 semanas; registre na documentação.

## Antes de terminar
- `pnpm -r typecheck`, `pnpm --filter @bybus/core test`, `pnpm --filter @bybus/api test`, `pnpm --filter @bybus/web test` todos verdes.
- Documente em `docs/produto/modulo-<modulo>.md`: o que faz, decisões, pendências e "a confirmar".
- Commits pequenos, mensagens em português, terminando com:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016yVVVfvbKPkAKk4S8PdvE7
  ```
- **Não faça push.** No relatório final: branch e último commit, arquivos compartilhados alterados, permissões/variáveis de ambiente/pacotes criados, pendências.
- Seja econômico: leia só o necessário da referência; não reescreva código que já existe.
