# @bybus/web — Bybus Gestão (painel web)

React 18 + Vite 5 + TypeScript + react-router-dom 6. CSS próprio com tokens em `src/estilos/tokens.css` (identidade provisória; claro/escuro).

## Rodar
1. API local em `127.0.0.1:3333` (ver `apps/api`), com `AMBIENTE=desenvolvimento`.
2. `pnpm --filter @bybus/web dev` → http://localhost:5173 (o Vite repassa `/api` para a API; outra URL: `BYBUS_API_URL`).

Usuários fictícios (só desenvolvimento/testes): `admin@` (todas as praças), `supervisor@`, `atendente@`, `guia@`, `motorista@bybus.test` (Florianópolis) e `supervisor.bc@bybus.test` (Balneário Camboriú), senha `Bybus-teste-2026`.

## Telas (Fase 1 — ADR 0005)
- **Seletor de praça** no topo (só para quem acessa mais de uma praça): filtra Saídas e é o filtro inicial de Equipe e Passeios; a escolha fica no `localStorage` (`bybus.praca`).
- **Saídas**: etiqueta da linha de negócio; criar saída escolhendo o passeio (agrupado por praça). "Veículo e equipe" escala guia e motorista do cadastro (`guiaId`/`motoristaId`); o cabeçalho é atualizado por `GET /api/saidas/:id`, sem recarregar (nem auditar) a lista.
- **Equipe** (`pessoas:ver`; edição com `pessoas:gerenciar`): filtros por papel/praça, destaque de CNH/Cadastur vencidos ou vencendo em 30 dias, diária em R$ (enviada em centavos), CSV.
- **Passeios** (`produtos:gerenciar`), **Praças** (`unidades:gerenciar`; criar/editar só quem acessa todas as praças), **Usuários** (perfil vindo de `/api/perfis`, todas as praças ou praças específicas) e **Perfis de acesso** (`usuarios:gerenciar`; ADMIN somente leitura).
- O menu usa só `permissoes` de `/api/auth/eu`, nunca o código do perfil.

## Scripts
- `typecheck`, `build`, `test` (vitest + Testing Library, sem rede).
- `test:e2e` (Playwright, contra a API local com dados fictícios). Se os navegadores estiverem fora do padrão: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Screenshots: `BYBUS_SCREENSHOTS=/pasta`.
  A API limita o login a 10 tentativas/minuto por IP; a suíte reaproveita a sessão de cada usuário fictício (9 logins). Espere 1 minuto entre execuções.

## Regras do front
- Toda requisição que não é GET envia `X-Bybus: 1`; cookies só `same-origin` (`src/api/cliente.ts`).
- O menu e os botões escondem o que o perfil não usa (`permissoes` de `/api/auth/eu`), mas quem decide é sempre o servidor.
- Datas `dd/mm/aaaa`, fuso `America/Sao_Paulo` (`src/util/formato.ts`). Validação de CPF no cliente só para ajudar; a regra final é do servidor.
- Atalhos: `g` + `s` (Saídas), `i` (Importar), `e` (Equipe), `p` (Passeios), `r` (Praças), `u` (Usuários), `f` (Perfis), `a` (Auditoria), `c` (Conta); `/` busca na lista; `?` mostra a ajuda.
