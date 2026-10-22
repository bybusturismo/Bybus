# @bybus/web — Bybus Gestão (painel web)

React 18 + Vite 5 + TypeScript + react-router-dom 6. CSS próprio com tokens em `src/estilos/tokens.css` (identidade provisória; claro/escuro).

## Rodar
1. API local em `127.0.0.1:3333` (ver `apps/api`), com `AMBIENTE=desenvolvimento`.
2. `pnpm --filter @bybus/web dev` → http://localhost:5173 (o Vite repassa `/api` para a API; outra URL: `BYBUS_API_URL`).

Usuários fictícios (só desenvolvimento/testes): `admin@`, `supervisor@`, `atendente@`, `guia@`, `motorista@bybus.test`, senha `Bybus-teste-2026`.

## Scripts
- `typecheck`, `build`, `test` (vitest + Testing Library, sem rede).
- `test:e2e` (Playwright, contra a API local com dados fictícios). Se os navegadores estiverem fora do padrão: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Screenshots: `BYBUS_SCREENSHOTS=/pasta`.
  A API limita o login a 10 tentativas/minuto por IP e a suíte usa 10: espere 1 minuto entre execuções.

## Regras do front
- Toda requisição que não é GET envia `X-Bybus: 1`; cookies só `same-origin` (`src/api/cliente.ts`).
- O menu e os botões escondem o que o perfil não usa (`permissoes` de `/api/auth/eu`), mas quem decide é sempre o servidor.
- Datas `dd/mm/aaaa`, fuso `America/Sao_Paulo` (`src/util/formato.ts`). Validação de CPF no cliente só para ajudar; a regra final é do servidor.
- Atalhos: `g` + `s`/`i`/`u`/`a`/`c` navega; `/` busca na lista; `?` mostra a ajuda.
