# Módulo IA — Gestores de IA e Turistinha (04/11/2026)

Camada de inteligência artificial do Bybus Gestão. Decisão de arquitetura em `docs/arquitetura/adr/0004-agentes-de-ia.md`. Referência de ideias: Gestores de IA, Assistente TOMA e Mascote do APP TOMA (`docs/gestao-inteligencia.md`), adaptados a uma empresa de turismo.

## O que faz

1. **Diretoria virtual (8 gestores):** comercial, logístico, frotas, administrativo (financeiro), marketing, jurídico, RH e tecnologia. Todo dia às **6h30 (America/Sao_Paulo)** cada gestor avalia a sua área; em seguida há uma **rodada de debate** (cada um lê os achados dos outros e complementa, concorda ou discorda); por fim uma **síntese** reúne **vulnerabilidades, oportunidades de crescimento e ações sugeridas**.
2. **Ações só viram tarefa/aviso quando uma pessoa aprova.** A IA nunca grava nada fora de suas próprias tabelas. Cada ação nasce `SUGERIDA` e uma pessoa com `ia:gestores` a **aprova** (`APROVADA`), **conclui** (`CONCLUIDA`) ou **descarta** (`DESCARTADA`); tudo auditado.
3. **Turistinha (assistente):** conversa em painel lateral, com ferramentas de **consulta somente leitura** que respeitam as permissões de quem pergunta.
4. **Sem chave, o sistema funciona:** mostra "IA desligada"; os alertas dos dados (calculados direto do banco, sem IA) continuam aparecendo no painel dos gestores.

## Fluxo da avaliação

```
retratos agregados (banco) ──► rodada 1: 8 gestores (paralelo, até 4 por vez) ──► rodada 2: debate (cada um lê os outros 7)
                                                                                        │
              ações SUGERIDAS ◄── síntese (modelo/esforço configuráveis) ◄──────────────┘
```

- Cada chamada exige **saída estruturada por ferramenta** (`registrar_avaliacao`, `registrar_debate`, `registrar_sintese`) com `strict: true`: `achados`, `vulnerabilidades`, `oportunidades`, `acoes_sugeridas` (a síntese acrescenta `resumo` e `pontos_de_discordia`). O servidor valida de novo com Zod e, se a saída vier inválida ou ausente, pede **uma** correção.
- Falha de um gestor não derruba o resto: a avaliação fica `PARCIAL` e o motivo aparece na tela. Falha da síntese = `FALHA`. Limite mensal atingido no meio = `LIMITE` (guarda o que já foi feito).
- Uma avaliação por vez (`409 EM_ANDAMENTO`). Avaliação "EXECUTANDO" há mais de 45 min é marcada como `FALHA` (servidor caiu). A rotina automática roda **uma vez por dia** (não duplica após reinício). Se o servidor estiver fora do ar às 6h30, o dia não é recuperado: use **Rodar agora**.
- "Rodar agora" responde na hora (`202`) e processa em segundo plano; a tela consulta o andamento a cada 4 s.

## LGPD — só agregados

- As funções de **retrato** (`apps/api/src/servicos/ia/retratos.ts`) leem o banco (`apps/api/src/db/schema.ts`) e devolvem **só contagens, somas, percentuais e alertas** por área. Nenhum nome, documento, telefone, e-mail ou identificador de pessoa sai do servidor.
- **Segunda barreira** (`packages/core/src/ia/lgpd.ts`): antes de enviar, `garantirAgregado` barra textos que pareçam e-mail, telefone, CPF/CNPJ e chaves de objeto como `nome`, `email`, `telefone`, `documento`. Se disparar, a avaliação falha em vez de vazar.
- O retrato enviado a cada gestor fica gravado na avaliação (`ia_avaliacoes.retratos`) para **auditar exatamente o que foi enviado à IA**.
- O assistente só recebe resultados agregados das ferramentas; se pedirem dados pessoais, o prompt manda recusar e indicar a tela com permissão própria.
- **Registro de uso** (`ia_uso`): tokens, custo, modelo, quem pediu e **nomes** das ferramentas consultadas — **nunca o texto das conversas**. A auditoria do assistente guarda só as ferramentas usadas.
- O histórico da conversa com o Turistinha fica só no navegador de quem conversa e viaja ao servidor com a próxima pergunta (últimas 20 mensagens).

### Retratos por área (o que cada gestor enxerga hoje)

| Gestor | Dados usados (todos agregados) |
|---|---|
| Comercial | ocupação, saídas abaixo do mínimo/lotadas, passageiros por canal (próximos e últimos 30 dias, variação vs. 30 dias anteriores), cancelamentos, concentração em um canal, ocupação por passeio |
| Logístico | hoje/amanhã/7 dias: saídas sem guia, motorista ou veículo, lista aberta; conferência pendente nas próximas 48h; reservas sem ponto de embarque; transfer; embarque e no-show dos últimos 7 dias |
| Frotas | veículos usados, saídas sem veículo, mesmo veículo em mais de uma saída no dia, saídas acima da capacidade |
| Administrativo | pagamento (pago, a pagar no embarque, cortesia, não informado), peso de cortesias, custo estimado das diárias de guias (centavos) |
| Marketing | mix de canais, venda direta, origem dos clientes (estado/país), reservas sem telefone |
| Jurídico | Cadastur dos guias e CNH dos motoristas (vencidos/vencendo), passageiros sem documento/com documento inválido, crianças e idosos, cancelamentos, acessos a documentos completos e exportações de lista, usuários sensíveis sem MFA |
| RH | equipe por papel, cobertura de guia nos próximos 14 dias, carga por guia, trocas por força maior, idiomas, validade de documentos |
| Tecnologia | usuários sem MFA/bloqueados, sessões ativas, falhas de login, integrações (Paytour/e-mail), mensagens com falha, auditoria, uso e limite da IA |

**Lacunas declaradas (viram "a confirmar" para os gestores):** o sistema ainda não tem valores de reservas, contas a pagar/receber, manutenção/documentos de veículos, contratos nem consentimento de mensagens. Os retratos de frotas, administrativo e jurídico trazem `lacunasDeDados` dizendo isso, para a IA **não inventar**. Quando os módulos de frota, financeiro etc. existirem, basta acrescentar dados com `registrarRetratoExtra(idDoGestor, fn)` — os gestores passam a enxergá-los sem mudar mais nada.

## Modelo, custo e limite

| Variável | Padrão | Para que serve |
|---|---|---|
| `ANTHROPIC_API_KEY` | vazio | Chave da API. **Só em variável de ambiente/cofre.** Vazio = "IA desligada". |
| `IA_MODELO` | `claude-opus-5-5` | Modelo dos gestores (avaliação e debate) e do assistente (o recomendado para o dia a dia). |
| `IA_MODELO_SINTESE` | = `IA_MODELO` | Opção mais forte para a síntese: `claude-fable-5-1` (US$ 10/50 por milhão de tokens, mais que o dobro do Opus 5.5). |
| `IA_ESFORCO` / `IA_ESFORCO_SINTESE` / `IA_ESFORCO_ASSISTENTE` | `medium` / `high` / `low` | `effort` do modelo (raciocínio adaptativo sempre ligado). |
| `IA_LIMITE_MES_USD` | `60` | Teto mensal. Ao atingir, novas chamadas são recusadas (`429 IA_LIMITE`). `0` = sem limite. |
| `IA_AVALIACAO_DIARIA` | `true` | Liga/desliga a rotina das 6h30 (só roda com chave). |
| `IA_AVALIACAO_HORARIO` | `06:30` | Horário (America/Sao_Paulo). |

- **Preços** (tabela de 06/10/2026, em `packages/core/src/ia/custo.ts`): Opus 5.5 US$ 4 / 20 por milhão de tokens (entrada/saída); leitura de cache 10%, escrita 125%. Modelo desconhecido é cobrado pelo preço mais alto (prudência).
- **Estimativa:** 17 chamadas por avaliação (8 + 8 + 1); ~150 mil tokens de entrada e ~36 mil de saída (+ raciocínio) ⇒ **≈ US$ 1 a 2 por dia (US$ 30 a 60 por mês)**, mais o uso do assistente. É o dobro da estimativa do ADR original porque **não usamos Batches** (ver ADR). **A confirmar com uso real** — o painel mostra o gasto do mês e a aba Histórico, o custo por avaliação.
- **Cache de prompt:** prompt de sistema e ferramentas ficam estáveis (sem data nem dados do dia); o que muda vai na mensagem do usuário.
- **Fallback de recusa:** as chamadas usam o `fallbacks: "default"` do servidor (beta `server-side-fallback-2026-07-01`), conforme a recomendação da Anthropic para esses modelos; se o modelo recusar sem solução, a chamada falha com mensagem clara.
- **Pacote novo:** `@anthropic-ai/sdk` **0.137.0** (fixo, sem `^`; lançado em 20/10/2026, mais de 2 semanas antes do uso). A linha 1.x existe, mas as versões 1.0.0/1.1.0 têm menos de 2 semanas.

## Permissões

| Permissão | Quem | O quê |
|---|---|---|
| `ia:usar` | qualquer perfil | Conversar com o Turistinha (botão no topo). Vê só as consultas que o seu perfil já permite. |
| `ia:gestores` (**sensível**, exige MFA) | direção/supervisão geral | Ver gestores, "Rodar agora", aprovar/descartar/concluir ações, ver custos. **Exige acesso a todas as praças**: os gestores consolidam a empresa inteira; quem enxerga só uma praça recebe 403 (decisão desta entrega, a confirmar). |

ADMIN recebe ambas automaticamente. Nenhum perfil padrão recebeu as permissões novas: o administrador as concede em **Perfis de acesso → Inteligência artificial**.

### Ferramentas do assistente (somente leitura)

| Ferramenta | Permissão exigida | Devolve |
|---|---|---|
| `resumo_saidas` | `manifesto:ver` | saídas do período: passageiros, capacidade, ocupação, se há guia/motorista/veículo/lista fechada |
| `ocupacao_por_passeio` | `manifesto:ver` | agregado por passeio |
| `reservas_por_canal` | `manifesto:ver` | reservas e passageiros por canal, confirmados/cancelados |
| `documentos_vencendo` | `pessoas:ver` | contagem (sem nomes) de Cadastur/CNH vencidos ou a vencer |
| `saude_do_sistema` | `auditoria:ver` + todas as praças | retrato de tecnologia |
| `ultima_sintese` | `ia:gestores` + todas as praças | síntese da última avaliação |

A permissão (e o escopo por praça, via `filtroUnidade`) é conferida **na oferta** e **de novo na execução**: se o modelo pedir uma ferramenta que o perfil não tem, recebe "indisponível".

## API (`apps/api/src/rotas/ia.ts`)

- `GET /api/ia/estado` (`ia:usar`) — ligada? Para `ia:gestores`, também modelo, limite, gasto do mês, agenda e andamento.
- `POST /api/ia/assistente` (`ia:usar`) — `{ mensagens: [{ papel: "usuario"|"assistente", texto }] }` (máx. 20, 4.000 caracteres cada); 20 por minuto por IP. `503 IA_DESLIGADA`, `429 IA_LIMITE`, `502 IA_ERRO`.
- `GET /api/ia/gestores`, `GET /api/ia/retratos` (indicadores do dia, sem IA), `GET /api/ia/avaliacoes`, `GET /api/ia/avaliacoes/:id`, `POST /api/ia/avaliacoes` (Rodar agora), `GET /api/ia/acoes`, `PATCH /api/ia/acoes/:id` (`APROVADA`/`DESCARTADA`/`CONCLUIDA`; transições inválidas = 409), `GET /api/ia/uso` — todas `ia:gestores`.
- Auditoria: `IA_AVALIACAO_INICIADA`, `IA_ACAO_APROVADA`, `IA_ACAO_DESCARTADA`, `IA_ACAO_CONCLUIDA`, `IA_ASSISTENTE_CONSULTA` (só os nomes das ferramentas).

### Tabelas (`apps/api/src/db/esquemas/ia.ts`)
`ia_avaliacoes` (retratos, síntese, custo, status), `ia_pareceres` (rodada 1 e 2 por gestor), `ia_acoes` (ciclo de aprovação), `ia_uso` (tokens e custo por chamada, `mes_ref` para o limite). **A migração será gerada na junção** (não foi commitada).

## Telas

- **Gestores de IA** (`apps/web/src/paginas/Gestores.tsx`, menu **Gestão → Gestores de IA**, atalho `g` `d`): abas **Painel do dia** (resumo, vulnerabilidades, oportunidades, ações com Aprovar/Descartar, alertas dos dados), **Cada gestor**, **A conversa entre eles** (debate e riscos que cruzam áreas), **Ações** (filtro por situação; concluir) e **Histórico**. Mostra "IA desligada", gasto do mês e botão **Rodar agora**.
- **Turistinha** (`PainelTuristinha.tsx`): botão no **topo** do Layout (visível com `ia:usar`) abre uma **coluna lateral** própria do layout — não flutua sobre o conteúdo no computador; no celular, por falta de espaço, ocupa a tela abaixo do topo enquanto aberto.

## Mascote — arte provisória e como trocar

`apps/web/src/componentes/Mascote.tsx` usa `apps/web/src/marca/turistinha.png` **se o arquivo existir**; até lá desenha um **SVG simples e provisório** (homem sorridente, chapéu panamá branco, camisa florida rosa/azul, bermuda azul, chinelos). Para trocar: salve a arte oficial (PNG com fundo transparente, proporção ~3:4) como `apps/web/src/marca/turistinha.png` e reinicie o servidor de desenvolvimento ou refaça o build. Nenhum código muda. O SVG provisório tem o atributo `data-provisorio="true"`.

## Testes
- `packages/core/test/ia.test.ts`: gestores, custo/preços, fuso de São Paulo, agenda 6h30, trava de LGPD.
- `apps/api/test/ia.test.ts` (**cliente de IA falso**; nenhuma chamada real): IA desligada, permissões, avaliação completa (2 rodadas + síntese; debate recebe achados dos outros; ações sem duplicata; aprovação/descarte), falha parcial, rotina diária (uma vez por dia), limite mensal, assistente (consulta, permissões, validação) e **verificação de que nenhum nome/e-mail/telefone do banco vai ao modelo**.
- Web: `Gestores.test.tsx`, `PainelTuristinha.test.tsx`, `Layout.test.tsx`.
- **Não testado:** chamada real à API da Anthropic (sem chave no ambiente); qualidade das avaliações com dados reais; custo real.

## Pendências e "a confirmar"
- **Chave da Anthropic e aprovação do custo** (ADR 0004 pedia aprovação do dono): configurar `ANTHROPIC_API_KEY` só depois de aprovar o teto (`IA_LIMITE_MES_USD`, padrão proposto US$ 60).
- **Modelo da síntese:** manter igual ao dos gestores ou usar o mais forte (`claude-fable-5-1`)? Decidir após ver a qualidade/custo reais.
- **Batches (50% mais barato):** avaliar depois; exigiria separar rodada 1, debate e síntese em lotes assíncronos.
- **"Viram tarefa/aviso":** ainda não há módulo de tarefas/avisos; ação aprovada fica na lista "Ações" com situação e responsável (área). Integrar com tarefas/avisos quando existirem.
- **Gestores só para quem vê todas as praças:** confirmar se supervisores de uma praça devem ver os gestores filtrados por praça.
- **Frota, financeiro, avaliações, contratos:** assim que esses módulos tiverem dados, alimentar os retratos (`registrarRetratoExtra`) — hoje os gestores só apontam a lacuna.
- **Insights úteis/não úteis** (feedback do ADR 0004): não implementado; hoje a medição é por ações aprovadas × descartadas no histórico.
- **Retenção:** definir por quanto tempo guardar avaliações, retratos e uso (a confirmar com o jurídico).
- Rodar a avaliação em servidor com mais de uma instância exigiria trava distribuída (hoje a trava é pelo banco, uma avaliação "EXECUTANDO" por vez, e o relógio é por processo).
