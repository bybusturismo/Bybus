# Levantamento: admin da Paytour × Bybus Gestão (04/11/2026)

Pedido do dono: tela inicial inspirada no admin da Paytour, módulo de Cupons e lista do que ainda falta.
Fonte: análise do dono da tela `bybusturismo.com.br/admin` + documentação da API Paytour v2 (lida pelo sistema).

Legenda: **Tem** = já existe · **Parcial** = existe sem alguma parte · **Falta** = não existe.

## Base que falta para quase tudo: valores das vendas

Hoje as reservas **não guardam valor** (só passageiros, canal, pagamento PAGO/A_PAGAR e forma). A API da Paytour traz
por pedido: `valor`, `desconto`, `subtotal`, `cupom_id` (e `desconto_cupom` por item), `metodo_pagamento`,
`parcelas_pagamento`, `data_hora_pedido`, `operador_id` (venda pelo admin × site), `afiliado_id` + `afiliado_comissao`,
`parceiro_id` + `parceiro_comissao`, `pagamento_pendente` + `pagamento_pendente_valor` (saldo), `utm_*`.
**Primeiro passo:** gravar esses campos na importação (só leitura da Paytour; nada é alterado lá). Viator (e-mail da Bókun)
traz o valor no e-mail (a confirmar em todos os modelos); a Decolar não traz valor no e-mail.

## Tela inicial (o que a Paytour tem)

| Item | Situação | Observação |
|---|---|---|
| Atalhos: + Nova reserva, Disponibilidade, Fazer check-in, Atividades, Listagem de reservas | Parcial | Reserva manual, saídas, embarque e passeios existem; **listagem geral de reservas falta** (hoje é por saída). |
| Faturamento do mês | Falta | Depende dos valores (acima). |
| Cupons utilizados no mês | Falta | Depende dos valores + cupons. |
| Alerta de pendências clicável | Parcial | Conferência de embarque já lista pendências; falta o atalho filtrado e "formulário pendente". |
| Maiores emissores (cidade/UF) | Parcial | Origem do cliente existe (Marketing), sem R$. |
| Comparativo 3 anos | Falta | Depende de importar o histórico com valores. |
| Reservas por dia da semana × canal | Parcial | Dados existem; gráfico falta. |
| Reservas por horário da compra (Site × Admin) | Falta | Depende de `data_hora_pedido` e `operador_id`. |
| Atividades mais vendidas (R$, nº, %) | Parcial | Vendas por passeio existem, sem R$. |
| Métodos de pagamento | Parcial | Forma de pagamento já é gravada; falta parcelas e R$. |
| Faturamento por período × canal | Falta | Depende dos valores. |
| **Somas nossas:** canais Viator/Decolar/Civitatis | Tem | GetYourGuide **falta** (não integrado). |
| Saídas de hoje com ocupação e equipe | Tem | Dados prontos (saídas, escala, frota). |
| Check-ins pendentes do dia | Tem | Embarque por saída. |
| Aguardando pagamento / saldo | Parcial | "Pagar no embarque" existe; saldo pendente depende da importação. |
| WhatsApp não lidas | Em construção | Central de conversas sendo feita. |
| Comissão de afiliados do mês | Falta | Depende de `afiliado_comissao`. |

## Itens do sistema

| Grupo | Item | Situação |
|---|---|---|
| A | **Cupons** (código, tipo %/R$, mínimo, total, por cliente, validade, opcionais, regra TODO/EXCETO/APENAS, afiliado, relatório) | **Falta.** A API da Paytour tem listar, criar, editar, excluir e validar cupons (`/cupons`) → importar os 118 é viável. |
| B | Reagendar lote de reservas | Falta |
| B | Mensagens recebidas (contatos do site) | Falta (o formulário é da loja Paytour; a API não lista esses contatos — a confirmar) |
| B | Fichas de clientes | Falta (item "Passageiros e clientes" está como "em breve") |
| B | Extrato de transferências (repasses) | Falta (o financeiro tem transferências entre contas, não os repasses da Paytour) |
| C | Produtos / passeios | Tem (cadastro, capacidade, mínimo, motorista e veículo padrão) |
| C | Pontos de embarque | Tem (com coordenadas para o rastreio) |
| C | Disponibilidades | Parcial (saídas por dia; sem horários múltiplos e sem venda) |
| C | Classificação de preços (adulto, criança…) | Parcial (categorias existem; **preços não**) |
| C | Períodos / sazonalidade, opcionais, formulários | Falta (são lidos da Paytour) |
| D | Apanhe de passageiros | Tem (lista de passageiros em ordem de embarque, fechamento das 21h) |
| D | Atividades do dia | Tem (Saídas) |
| D | Atividades vendidas, reservas por atividade/período | Parcial (sem R$) |
| D | Reservas por usuário, usuários por período, fichas de reservas, utilização de vouchers, comissão por afiliados, comparativo mensal, visão geral de excursões | Falta |
| D | Resumo financeiro | Tem (Financeiro) |
| E | Cupons | Falta (ver A) |
| E | Tour 365, pixels & tags, SEO | Falta — são da **loja/site** (hoje na Paytour); "Tour 365" a confirmar |
| F | Lista de afiliados | Parcial (cadastro com QR code, sem ligação com os afiliados da Paytour) |
| F | Extrato de transações de afiliados | Falta (viável com `afiliado_id` e `afiliado_comissao`) |
| G | Usuários e perfis | Tem (com MFA, praças e auditoria) |
| G | API | Tem (Paytour, e-mails Viator/Decolar) |
| G | Regras, meios de pagamento, documentos legais, maquininha | Falta — são da **venda/checkout** (hoje na Paytour) |

## Decisão que muda o tamanho do trabalho

Vários itens (disponibilidade para venda, preços, opcionais, formulários, meios de pagamento, maquininha, SEO, pixels,
documentos legais e a própria "Nova reserva" com pagamento) só fazem sentido aqui se a By Bus **deixar de vender pela
Paytour**. Pelo ADR 0001 a Paytour continua sendo a loja e o checkout, e o Bybus Gestão é a gestão de todos os canais.
Cupons só funcionam no checkout: com a Paytour como loja, o cupom precisa existir **lá**.

## Decisões do dono (04/11/2026)

1. **A Paytour continua sendo a loja (site) e o checkout.** Não serão construídos aqui: preços e disponibilidade de venda,
   opcionais, formulários, meios de pagamento, maquininha, SEO, pixels e documentos legais da loja. Foco: tela inicial,
   cupons, relatórios, afiliados, fichas de clientes e reagendamento.
2. **Cupons são criados e editados no Bybus Gestão e enviados à Paytour pela API** (`POST/PUT/DELETE /cupons`).
   Os 118 cupons atuais são importados primeiro. Ver ADR 0008.

## Ordem de construção

1. Importação dos valores das vendas (Paytour) — base da tela inicial.
2. Tela inicial (Visão Geral) com escopo de praça.
3. Módulo de Cupons (importação, cadastro com envio à Paytour, relatório de uso).
4. Depois: listagem geral de reservas, fichas de clientes, reagendar lote, comissão e extrato de afiliados, relatórios do grupo D.
