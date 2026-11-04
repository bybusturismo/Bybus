# Módulo Biblioteca (04/11/2026)

Manuais e procedimentos da operação, em páginas com subpáginas, escritos em Markdown. Referência de ideias: Biblioteca e manuais do APP TOMA (`docs/outros-modulos.md`), sem o gravador de passos.

## Permissões
| Permissão | O que libera |
|---|---|
| `biblioteca:ver` | Ler as páginas "para toda a equipe" e buscar nelas. |
| `biblioteca:editar` | Criar, editar, mover e excluir páginas; ver e editar as **restritas**. |

O Administrador recebe as duas pelo código. Perfis padrão não recebem automaticamente (ver pendências).

## Como funciona (`/biblioteca`, `apps/web/src/paginas/biblioteca/`)
- **Árvore** lateral (no celular fica acima do texto) com busca por **título e texto**; a página aberta mostra trilha de navegação, subpáginas e data da última atualização.
- **Editor** com pré-visualização ao lado: título, "Dentro de" (a lista nunca oferece a própria página nem as de dentro dela), ordem no menu e acesso.
- **Acesso:** *Toda a equipe* (quem tem `biblioteca:ver`) ou *Só quem edita*. A restrição **vale também para todas as subpáginas**. Para quem só lê, página restrita não aparece na árvore, não abre (404) e não aparece na busca.
- **Excluir** é recusado (409) enquanto a página tiver subpáginas; mover é recusado quando criaria ciclo.
- Toda criação, edição e exclusão vai para a **auditoria** (o texto da página não é gravado na auditoria, só o que mudou e o tamanho).

## Markdown seguro (decisão)
Em vez de `marked` + `dompurify`, foi escrito um **analisador próprio** em `packages/core/src/biblioteca/markdown.ts` que devolve uma **árvore de dados**, e a tela monta **elementos React** a partir dela. Não existe `innerHTML`, então não há como executar script, e **nenhum pacote novo** foi adicionado. Regras:
- Suporta títulos, parágrafos, listas, citação, código, régua, tabela, **negrito**, *itálico*, `código` e links.
- **HTML digitado aparece como texto** (testado com `<script>` e `<img onerror>`).
- Links só `http`, `https`, `mailto`, `tel` ou caminho interno (`/biblioteca/...`); `javascript:`, `data:`, `vbscript:` e `//host` viram só o texto. Links externos abrem com `rel="noopener noreferrer"`.
- Limites: conteúdo de até 100 000 caracteres; aninhamento de formatação limitado (sem travar com entrada maliciosa; testado).

## Banco e API
- Tabela `biblioteca_paginas` (`apps/api/src/db/esquemas/biblioteca.ts`): `pai_id` (auto-referência), `titulo`, `conteudo`, `acesso`, `ordem`, `chave_semente` (única), autor e datas.
- Rotas em `apps/api/src/rotas/biblioteca.ts`: `GET /api/biblioteca/paginas` (árvore, sem texto), `GET /api/biblioteca/paginas/:id`, `GET /api/biblioteca/busca?q=` (mínimo 2 letras, curingas `%` e `_` tratados como texto), `POST`, `PATCH` e `DELETE` (editor).
- Regras de árvore e acesso efetivo em `packages/core/src/biblioteca/arvore.ts`, com testes.

## Semente (manuais operacionais)
`apps/api/src/db/biblioteca-seed.ts` (`semearBiblioteca`) é **idempotente**: cada página tem uma chave e só é criada se não existir, então edições da equipe nunca são sobrescritas. Roda no `db:seed` (junto com a referência) e nos testes. Conteúdo **só do que está em `docs/conhecimento`** e no plano da Fase 2, com "a confirmar" onde não está validado:

| Página | Fonte |
|---|---|
| Manuais operacionais (índice) | — |
| City Tour Toda Ilha (Florianópolis): dias, duração, paradas, roteiro citado pelo site, **pontos de embarque** (tabela gerada de `PONTOS_TODA_ILHA`, os pontos oficiais) | `produtos-e-site.md`, `google-drive.md` |
| BC By Bus (Balneário Camboriú): horário, parada no Oceanic, regras (proibido comer, pets até 25 kg, cinto) | `produtos-e-site.md`, `google-drive.md` |
| Regras de embarque e confirmação de saída (mínimo 10–12, 8–9 decide a supervisão, conferência, embarque) | `google-drive.md`, `plano-fase-2.md` |
| Fluxo da lista das 21h (venda → fechamento → adendo → pós-passeio) | `plano-fase-2.md` |
| Reservas de Viator, Decolar e Civitatis (como chega cada uma, cancelamento manual da Decolar, bloqueio à noite) | `canais-e-integracoes.md`, `google-drive.md` |
| Quiosque do Villa Romana Shopping (horário, pagamento) | `google-drive.md`, `produtos-e-site.md` |

## Pendências e "a confirmar"
1. **Lista oficial das 6 paradas** do City Tour Toda Ilha e coordenadas dos pontos de embarque.
2. Conflito nas fontes: "12 pontos entre 6h50 e 10h" (Drive) × pontos cadastrados (13 linhas, de 06:50 a 10:00) — o manual cita os dois.
3. Pontos, horários e capacidade de Balneário Camboriú no cadastro; política de chuva, cancelamento e idade/gratuidade (não encontradas).
4. Significado exato das colunas TP, Estado, PG e Pesquisa da lista em papel.
5. **Perfis padrão:** conceder `biblioteca:ver` a guias/motoristas/atendentes (para ler os manuais) e `biblioteca:editar` à supervisão — decisão do dono; hoje só o Administrador tem acesso até concederem.
6. Histórico de versões da página e anexos/imagens: fora do escopo desta entrega (a auditoria registra quem editou e quando).
