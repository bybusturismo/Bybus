# Módulo Frota e manutenção

> Entregue em 04/11/2026 (Fase 2). Referência de ideias: Frota do APP TOMA (`docs/outros-modulos.md`, `server/src/frota.js`, `km.js`), adaptada a uma empresa de turismo. Fatos do negócio em `docs/conhecimento/frota.md`.

## O que faz
- **Veículos:** placa (padrão antigo ou Mercosul, guardada sem hífen), apelido, tipo (ônibus de dois andares, ônibus, trenzinho, van), modelo, ano, lugares, chassi, RENAVAM, linha principal (texto livre), uso publicitário, situação (ativo, em manutenção, inativo), km atual e praça. Escopo por praça: quem não tem a praça não enxerga o veículo (404).
- **Documentos:** CRLV, licença municipal, ANTT, seguro, cronotacógrafo, vistoria e outros, com vencimento. Situação calculada na hora: **a vencer** (de hoje até 30 dias; o dia do vencimento ainda vale), **vencido** e em dia. Aparecem no painel e na tela de documentos; o alerta é visual e no painel (ainda não há e-mail/WhatsApp, ver pendências).
- **Planos preventivos:** por km, por dias ou os dois (vale o que chegar primeiro). Situação: em dia, próxima (faltam até 1.000 km ou 30 dias), vencida ou sem base (sem última execução informada). Plano **crítico** vencido bloqueia o veículo.
- **Ordens de manutenção:** preventiva ou corretiva, oficina, peças, custo em centavos, status (aberta, em andamento, concluída, cancelada) e dias parado (conclusão menos abertura; se aberta, até hoje). Ordem marcada como "veículo parado" coloca o veículo em manutenção enquanto estiver aberta; ao concluir ou cancelar a última, ele volta a ativo. Concluir preventiva ligada a um plano zera o plano (km e data da execução) e registra o km da ordem. Ordem encerrada não muda mais.
  - **Detalhes (dono, 13/11/2026):** descrição do serviço em caixa grande (10 linhas, até 5.000 caracteres), **valor das
    peças** e **valor do serviço** (o custo total passa a ser a soma), **KM atual** e **KM da revisão/garantia**, e anexos da
    **ordem de serviço**, **NF (peças)** e **NFS-e (serviço)**: PDF, foto, XML da nota ou Word/Excel, até 15 MB, cifrados
    (`veiculos_ordens_anexos`), auditados, abertos só por quem vê a frota. Anexos podem ir na abertura ou na conclusão.
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

- **Abastecimento — filtro por coluna (dono, 13/11/2026):** cada cabeçalho (data, veículo, km, litros, valor, km/l, posto)
  abre o menu como no Excel (classificar A–Z/Z–A ou menor/maior, buscar e marcar só os valores desejados), o mesmo do
  financeiro (`componentes/FiltroColuna.tsx`). Com filtro ativo, o rodapé mostra quantos aparecem e a soma de litros e valor.
- **Abastecimento — serviço e mesmo km (dono, 13/11/2026):** campo **Serviço** (Combustível, Óleo, Lubrificante;
  `veiculos_abastecimentos.tipo`). Só combustível entra no km/l e nos litros do resumo; óleo e lubrificante entram no gasto.
  O **mesmo km** passou a ser aceito (antes dava "km repetido"): ex. cupom com duas linhas de diesel — cada linha é lançada
  com o mesmo km e o km/l soma os litros das linhas (fica na última). Coluna e filtro "Serviço" na lista.

## Veículo só por lista suspensa (16/11/2026)
Pedido do dono: "o veículo apareça todos cadastrados em uma lista suspensa só pra selecionar… todo sistema precisa ser assim".
- **Onde mudou:**
  - saída (Veículo e equipe);
  - escala (veículo padrão);
  - transfer e configuração do transfer (saiu o "Outro (digitar placa)");
  - financeiro (lançamentos e lançamento pelo extrato);
  - grupos fechados.

  Em todas essas telas o veículo é escolhido na lista dos veículos da Frota, ativos e em manutenção, mostrando placa, apelido, tipo e lugares. Os inativos ficam fora da lista.
- **Saída:** ao escolher o veículo, a capacidade da saída passa a ser a quantidade de lugares do veículo (dá para mudar depois).
- **Servidor:** a saída e a escala só aceitam uma placa cadastrada (erro `VEICULO_FORA_DO_CADASTRO`). A regra antiga ("placa fora da frota é aceita") deixou de valer.
- **Valores antigos:** o que foi digitado antes continua aparecendo como opção "(digitado antes, fora do cadastro)" até alguém trocar. Nada se perde.
- **Grupo criado de um orçamento:** o veículo fica para escolher na ficha, e o tipo orçado (van, micro ou ônibus) vai para as observações.
- **Fonte da lista:** `GET /api/frota/veiculos/opcoes`, liberada para quem gerencia saídas, escala, frota, reservas ou financeiro.
- **Guia e motorista** já eram escolhidos da lista do cadastro Equipe em todo o sistema (saída, escala, transfer e grupos).

## Diário de km (18/11/2026)
- Pedido do dono: aba de registro diário com **DATA › PLACA › KM INICIAL › KM FINAL › CONSUMO**. Tela em Frota → **Diário de km** (`/frota/km-diario`).
- **Consumo** = litros gastos no dia (opcional; suposição desta versão, a confirmar com o dono). Com ele, o sistema calcula o **km/l**; o **km rodado** (final − inicial) é sempre calculado.
- Um registro por veículo e dia (`veiculos_km_diario`, migração 0060). Ao lançar, o **km inicial vem sugerido** com o km final do dia anterior (ou o km atual do veículo).
- Conferências: km final ≥ inicial; no máximo 3.000 km num dia; data não futura; mesma placa e data não se repete (corrige-se o existente). Se o km inicial ficar abaixo do km final do dia anterior (ou o final acima do inicial do dia seguinte), a tela avisa e só grava ao confirmar. Na lista, "N km sem registro antes" mostra trechos que ficaram sem lançamento.
- O **km final vira leitura de km** (fonte `DIARIO`): atualiza o km atual do veículo e os planos de manutenção, sem nunca baixar o km (data antiga não mexe no km atual). A fonte `DIARIO` não é aceita no lançamento avulso de leitura.
- Quem lança: quem gerencia a frota ou quem faz o checklist (motorista com `frota:checklist`, que também ganha o atalho "Diário de km" no menu e na tela do motorista). Corrigir e excluir: só quem gerencia. Tudo auditado (`VEICULO_KM_DIARIO_LANCADO/CORRIGIDO/EXCLUIDO`).
- Lista com filtro por placa e período, filtro/classificação por coluna e resumo por veículo (dias, km rodado, litros, média km/l). Regras puras em `packages/core/src/frota/diario.ts`; API em `apps/api/src/rotas/frota-diario.ts`.
- Pendente do dono: o perfil padrão **Motorista** ainda não tem `frota:checklist` (decisão "permissões dos perfis padrão nos módulos novos"); sem ela, o motorista não vê o checklist nem o diário.

## Abastecimento pela foto do cupom (18/11/2026)
- Ideia do dono: o motorista manda a foto do cupom na hora do abastecimento (app ou WhatsApp), o sistema lê e abre um **abastecimento pendente**; o pagamento é com o Financeiro (comprovante e/ou marcar como pago).
- **Média (km/l)**: (km deste tanque cheio − km do tanque cheio anterior) ÷ litros colocados desde então — a fórmula do dono, com os abastecimentos parciais somados no próximo tanque cheio. Só abastecimentos **conferidos** entram no km/l, no painel, nos custos e na IA.
- **Pelo app** (Frota → Abastecimento → "Enviar foto do cupom"; motorista com `frota:checklist` também, com atalho no menu e na tela do motorista): foto do cupom (câmera), foto do painel opcional, placa e km opcionais. Fotos grandes são reduzidas no celular (lado maior até 2000 px) e guardadas cifradas.
- **Pelo WhatsApp** (Evolution ou Meta): mensagem com foto/PDF de um **motorista do cadastro da equipe** (papel MOTORISTA, telefone igual ao do WhatsApp) abre o pendente. Placa pela legenda ("ABC1D23 120500"), pelo cupom ou pela escala do dia (se for uma placa só); km pela legenda ou pela foto do painel. O sistema responde o que entendeu e pede o que falta (placa e km); a resposta em texto completa o último pendente (até 12 h). Segunda foto em até 10 min junta ao mesmo pendente. Mensagens de quem não é motorista seguem normais na caixa de conversas. Download da mídia: Evolution pelo base64 do aviso ou `chat/getBase64FromMediaMessage` (a confirmar na versão instalada); Meta pelo id da mídia com o token. **Depende do WhatsApp real ligado** (provedor ainda pendente: em "simulado" nada chega).
- **Leitura pela IA** (quando a chave da IA está configurada): litros, valor total, preço/litro, combustível, posto, CNPJ, data, km do painel e placa; nunca CPF/cartão. O que o motorista digitou vale mais. Custo registrado no uso da IA (tipo ABASTECIMENTO). Sem IA, o pendente segue e a conferência preenche olhando a foto.
- **Conferência** (quem gerencia a frota): ajusta placa, data, km, litros, valor, posto, tanque cheio e forma de pagamento; vira **CONFERIDO**, sobe o km do veículo e **gera a conta a pagar** no Financeiro (categoria Combustível — em BC "Combustível (posto BC)" —, praça e placa do veículo, posto como fornecedor) com a **foto do cupom anexada como nota fiscal**. O pagamento é a baixa dessa conta (com o comprovante), feita pelo Financeiro; a lista de abastecimentos mostra "Em aberto · vence…", "Pago em…" e "sem comprovante".
- **Forma de pagamento por praça** (Frota → Abastecimento → "Pagamento do combustível por praça"): padrão BC = faturado no posto (vence data + prazo da fatura, 30 dias até o dono confirmar) e Florianópolis = cartão de crédito (vence no dia). Lançamento manual também pode gerar a conta (marcado por padrão na tela).
- Excluir: pendente pelo motorista que mandou ou por quem gerencia; conferido só por quem gerencia — a conta em aberto sai junto; conta paga ou conciliada impede (desfazer no Financeiro antes).
- Atenção ao Financeiro: a partir da publicação, combustível conferido na Frota já vira conta a pagar — não lançar à mão de novo (o aviso de lançamento repetido do Financeiro ajuda, mas só nas últimas 12 h).
- Migração 0061 (`veiculos_abastecimentos`: situação, origem, forma de pagamento, conta, leitura da IA, motorista, conferência; `veiculos_abastecimentos_fotos`). API em `apps/api/src/rotas/frota-abastecimento.ts`, serviços `servicos/abastecimentoFoto.ts` e `servicos/abastecimentoWhatsapp.ts`; regras puras em `packages/core/src/frota/abastecimentoFoto.ts`.
