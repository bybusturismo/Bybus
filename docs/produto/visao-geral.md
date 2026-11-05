# Visão Geral (tela inicial) e valores das vendas (04/11/2026)

Pedido do dono: tela inicial inspirada no admin da Paytour (ver `levantamento-paytour.md`). A Paytour continua sendo a loja; aqui só se lê.

## Valores das vendas
- Tabela `vendas` (um registro por pedido) e, em `reservas`, `venda_id`, `valor_centavos` e `desconto_centavos` (parte da reserva no pedido). Dinheiro em centavos (BRL), instantes em UTC.
- Campos da Paytour usados: `valor`, `desconto`, `pagamento_detalhes.subtotal`, `cupom_id`, `metodo_pagamento`, `metodo_pagamento_externo`, `tipo_pagamento`, `parcelas_pagamento`, `data_hora_pedido` (lido como Brasília, UTC−3), `operador_id`, `afiliado_id`, `afiliado_comissao`, `parceiro_id`, `parceiro_comissao`, `pagamento_pendente(_valor/_pago_em)`, `utm_*`, `cliente_cidade`; por item, `valor` e `opcionais[].valor`.
- Rateio: o total do pedido é repartido entre as reservas (uma por data+passeio) pelo valor dos itens (+ opcionais); sem valor nos itens, pelas pessoas. Maiores restos: nenhum centavo se perde.
- Canal de venda (`canal_venda`): OTA (reserva de Viator/Decolar/Civitatis) > PARCEIRO (`parceiro_id`) > AFILIADO (`afiliado_id`) > BALCAO (método com "maquinin") > ADMIN (`operador_id`) > SITE. No gráfico, reserva lançada à mão = Maquininha/Balcão; importada sem pedido = "Sem canal identificado".
- Viator (e-mail da Bókun): lê "Total", "Total price", "Price"… em reais (outra moeda não é convertida: sem valor, com aviso). Decolar: sem valor. Reserva manual: `valorCentavos` opcional (exige `financeiro:ver`; alteração auditada com antes e depois).
- Reimportar/sincronizar atualiza o pedido (chave `pedido_codigo`) e preenche as reservas antigas; idempotente.
- A confirmar: se `valor` do item é total da linha ou unitário (só pesa no rateio); fuso de `data_hora_pedido` e do "Created" da Bókun; nomes das linhas de valor no e-mail real da Bókun; identificação da maquininha na Paytour; reservas do CSV da Paytour ainda não trazem valor.

## Permissões
- Atalhos, saídas de hoje, check-ins e pendências: `manifesto:ver`.
- Análises de vendas (emissores, dia da semana, horário, passeios, pagamentos): `manifesto:ver` + (`marketing:ver` ou `financeiro:ver`).
- Qualquer R$ (faturamento, desconto de cupons, saldo, comissão, valor na listagem): `financeiro:ver`; sem ela o campo vem `null` e o bloco some. Comparativo e faturamento por período dão 403 sem ela.
- Escopo de praça sempre no servidor (`filtroUnidade`); `unidadeId`/`passeioId` fora do escopo = 404. Só números agregados.

## API
`GET /api/visao-geral/{resumo,emissores,comparativo,dia-semana,horario-compra,passeios,pagamentos,faturamento}` (período padrão: 30 dias, por data da compra; filtros `de, ate, unidadeId, passeioId, canal`) e `GET /api/reservas` (listagem geral; filtros de período do passeio, passeio, canal, situação, conferência, `pendencia`, busca, paginação).
WhatsApp não lido: bloco preparado e oculto (não existe a central de conversas nesta versão). GetYourGuide aparece como "não integrado". Cupons: mostra o id da Paytour até existir o cadastro (ADR 0008).
