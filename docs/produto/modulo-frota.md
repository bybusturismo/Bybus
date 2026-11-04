# Módulo Frota e manutenção

> Entregue em 04/11/2026 (Fase 2). Referência de ideias: Frota do APP TOMA (`docs/outros-modulos.md`, `server/src/frota.js`, `km.js`), adaptada a uma empresa de turismo. Fatos do negócio em `docs/conhecimento/frota.md`.

## O que faz
- **Veículos:** placa (padrão antigo ou Mercosul, guardada sem hífen), apelido, tipo (ônibus de dois andares, ônibus, trenzinho, van), modelo, ano, lugares, chassi, RENAVAM, linha principal (texto livre), uso publicitário, situação (ativo, em manutenção, inativo), km atual e praça. Escopo por praça: quem não tem a praça não enxerga o veículo (404).
- **Documentos:** CRLV, licença municipal, ANTT, seguro, cronotacógrafo, vistoria e outros, com vencimento. Situação calculada na hora: **a vencer** (de hoje até 30 dias; o dia do vencimento ainda vale), **vencido** e em dia. Aparecem no painel e na tela de documentos; o alerta é visual e no painel (ainda não há e-mail/WhatsApp, ver pendências).
- **Planos preventivos:** por km, por dias ou os dois (vale o que chegar primeiro). Situação: em dia, próxima (faltam até 1.000 km ou 30 dias), vencida ou sem base (sem última execução informada). Plano **crítico** vencido bloqueia o veículo.
- **Ordens de manutenção:** preventiva ou corretiva, oficina, peças, custo em centavos, status (aberta, em andamento, concluída, cancelada) e dias parado (conclusão menos abertura; se aberta, até hoje). Ordem marcada como "veículo parado" coloca o veículo em manutenção enquanto estiver aberta; ao concluir ou cancelar a última, ele volta a ativo. Concluir preventiva ligada a um plano zera o plano (km e data da execução) e registra o km da ordem. Ordem encerrada não muda mais.
- **Abastecimentos:** data, km, litros, valor (centavos), posto e "completou o tanque". O **km/l** é calculado entre tanques cheios (parciais entram na soma dos litros). O **alerta** compara com a média do próprio veículo (precisa de 3 cálculos anteriores): pior que 20% = "gasto alto" (vazamento, desvio, defeito); melhor que 40% = "conferir lançamento" (provável erro de digitação). Mesmo km repetido no mesmo veículo é recusado.
- **Leituras de km:** o km do veículo **só sobe**. Leitura manual menor que o km atual é recusada (409). Todo abastecimento, checklist, conclusão de ordem e leitura manual gera uma linha em `veiculos_km` (histórico e base do km rodado no mês).
- **Checklist diário (celular):** itens configuráveis (grupo, descrição, "item de segurança"), iniciados a partir da planilha "chekin list" e da Cartilha do Motorista. O motorista escolhe o veículo, marca OK/Problema em cada item (botões grandes), descreve cada problema e informa o km (opcional). O checklist guarda uma cópia dos itens (mudar a lista depois não altera o histórico). **Item de segurança com problema reprova o checklist, abre uma ordem corretiva que imobiliza o veículo e o tira da escala** até a equipe concluir/cancelar a ordem.
- **Painel:** disponibilidade da frota (veículos liberados / em operação), veículos indisponíveis com motivos, próximos vencimentos, próximas manutenções, checklists pendentes e reprovados hoje, consumo fora da média (30 dias), **custo por veículo no mês** (manutenção concluída no mês + combustível) e **custo por km** (km rodado no mês pelas leituras).
- **Bloqueio na escala:** um veículo é "indisponível" se estiver inativo ou em manutenção, tiver documento vencido, plano crítico vencido ou ordem imobilizante aberta (`motivosBloqueio` no pacote `core`).

## Ligação com Saídas (sem quebrar o texto atual)
`saidas.veiculo` (e `passeios.veiculo_padrao`) continuam sendo **texto** (a placa). Este módulo oferece:
- `GET /api/frota/veiculos/opcoes?unidadeId=` — lista enxuta (placa, apelido, tipo, lugares, disponível, motivos) para preencher o campo; aceita quem tem `frota:ver`, `saidas:gerenciar`, `escala:gerenciar` ou `frota:checklist`.
- `GET /api/frota/disponibilidade/:placa` — diz se a placa está liberada e por que não.

**Não alterei** as telas/rotas de Saídas e Escala (arquivos de outros módulos). Passo seguinte, a combinar: trocar o campo de texto por uma lista com essas opções (continuando a gravar a placa) e **avisar ou recusar** veículo indisponível ao criar/editar saída e ao publicar escala.

## Interface preparada para o rastreador Khronos
`registrarLeituraKm(db, { veiculoId, km, data, fonte, usuarioId, estrito })` em `apps/api/src/servicos/frota.ts` é o ponto único de entrada de km. A integração futura só precisa chamar essa função com `fonte: "KHRONOS"` (leitura menor que o km atual é ignorada sem erro, quando não `estrito`). A rota manual recusa `KHRONOS` de propósito. Falta: API do Khronos, mapeamento placa ↔ rastreador e agendamento (a combinar).

## Permissões (em `permissoes.ts`, `tipos.ts` e `rotulos.ts`)
| Permissão | Para quê |
|---|---|
| `frota:ver` | Consultar veículos, documentos, planos, ordens, abastecimentos, histórico de checklist e painel |
| `frota:gerenciar` | Cadastrar/editar tudo, registrar km, editar itens do checklist |
| `frota:checklist` | Preencher o checklist diário (motorista, só da própria praça) |

ADMIN recebe todas pelo código. **Perfis existentes não ganham as permissões sozinhos:** a migração (gerada depois da junção dos módulos) deve acrescentar `frota:ver` e `frota:gerenciar` ao perfil SUPERVISOR (a confirmar com o dono) e quem criar um perfil de motorista marca `frota:checklist`. Nenhuma é "sensível" (sem MFA obrigatório); a confirmar, porque `frota:gerenciar` mexe em custos.

## Rotas (`apps/api/src/rotas/frota.ts`)
`/api/frota/` + `veiculos` (GET, POST, GET/PATCH `:id`, `opcoes`), `disponibilidade/:placa`, `documentos`, `planos`, `ordens`, `abastecimentos`, `leituras-km`, `checklist/itens`, `checklist/veiculos`, `checklists`, `painel?mes=AAAA-MM`. Zod em toda entrada, auditoria em toda gravação (`VEICULO_*`, `CHECKLIST_ITEM_*`). Não há exclusão de veículo (inativa-se); documentos e abastecimentos podem ser excluídos (fica na auditoria); ordens encerradas não mudam.

## Banco (`apps/api/src/db/esquemas/frota.ts`)
`veiculos`, `veiculos_documentos`, `veiculos_planos`, `veiculos_ordens`, `veiculos_abastecimentos`, `veiculos_km`, `checklist_itens`, `veiculos_checklists`. Dinheiro em centavos inteiros; datas `date` (AAAA-MM-DD); litros em `double precision` (o drizzle 0.36 não tem `numeric` como número). Migração **não commitada** (gerada depois da junção).

## Telas (`apps/web/src/paginas/frota/`)
Painel (`/frota`), Veículos, Documentos, Manutenção (ordens e planos), Abastecimento e Checklist (preencher, histórico, itens). Menu Administrativo: "Frota e manutenção" (`frota:ver`) e "Checklist do veículo" (`frota:checklist`); o item planejado `/em-breve/frota` foi removido. Quem só tem `frota:checklist` cai direto no checklist ao entrar.

## Decisões tomadas sem o dono (revisar)
- Antecedência do alerta de documentos: 30 dias (pedido); planos avisam a 1.000 km ou 30 dias.
- Item de segurança reprovado no checklist **imobiliza o veículo automaticamente** (preferi errar para o lado da segurança; a equipe libera cancelando/concluindo a ordem).
- Qualquer documento vencido bloqueia, mesmo os que talvez não sejam obrigatórios para todas as linhas.
- Uma praça por veículo (um veículo que "troca de base" é editado). Divergência de alocação (3 BC / 1 Floripa × documentos) segue em `docs/conhecimento/frota.md`.
- Itens iniciais do checklist (20 itens, 7 de segurança) vêm da planilha/cartilha e são criados na primeira leitura da lista (não há seed na migração).

## A confirmar com o dono
- Quais documentos são obrigatórios por tipo de veículo e linha (licença municipal de cada cidade, ANTT, autorização de fretamento, laudos LIT/SIE/DETER, selo turismo, Inmetro) e se algum não deve bloquear.
- Quais itens do checklist são de segurança (bloqueiam) e se a Cartilha do Motorista tem itens a mais.
- Placas, modelos e lugares reais da van e do trenzinho; qual ônibus é o publicitário; praça de cada veículo.
- Intervalos reais dos planos (óleo, filtros, correias, freios, suspensão, ar-condicionado, baterias, pneus).
- Se o motorista também lança abastecimento pelo celular (hoje só `frota:gerenciar`).
- Tolerâncias do alerta de consumo (20% / 40%) depois de ver o histórico real (~27,7 mil litros nas planilhas).

## Pendências / próximos passos
- **Avisos ativos:** e-mail/WhatsApp 30 e 7 dias antes e no vencimento (como o APP TOMA faz); depende de provedor de mensagens.
- Integrar Saídas e Escala (lista de veículos e bloqueio de veículo indisponível) e importar a planilha de abastecimento e a agenda de manutenção ("chekin list") existentes.
- Pneus (posição, sulco, recapagem), lavagem, indicador MTBF e fotos/anexos de documento (CRLV etc.).
- Integração com o rastreador Khronos (ver acima).
- Migração: criar tabelas e dar as permissões aos perfis existentes.

## Testes
`packages/core/test/frota.test.ts` (regras puras), `apps/api/test/frota.test.ts` (API com Postgres real: escopo por praça, documentos, bloqueio, planos/ordens, consumo, checklist e painel) e `apps/web/src/paginas/frota/Frota.test.tsx`. Dados e placas fictícios (ex.: ABC1D23).
