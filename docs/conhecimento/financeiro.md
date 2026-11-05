# Financeiro (situação atual)

> Resumo qualitativo. Valores detalhados ficam no Drive; não são versionados aqui.

## Como é feito hoje
- Fluxo de caixa em Excel/Sheets alimentado por extrato bancário (cooperativas de crédito). Categorias: REC, FROTA, RH, PESS, ADM, TRIB, TAXAS, COMISSÃO — digitadas à mão, com grafias inconsistentes.
- Caixa diário do quiosque em **três lugares** (caderno + Google Form "Controle Diário" + planilha), com reservas para abastecimento, diária de guia e transfer.
- Comissões de parceiros e afiliados em planilhas mensais; NF da Paytour, NFS-e para a Decolar e boletos de impostos em pastas soltas.
- Receita concentrada no contrato de transporte com o Grupo Oceanic; existem empréstimos, consórcio, parcelamentos e financiamento em curso.

## O que falta
- DRE gerencial; orçamento anual; centro de custo por ônibus, cidade e linha de negócio; conciliação de recebíveis por canal (OTAs, gateways); separação rigorosa entre despesas pessoais e da empresa; trilha de auditoria do caixa em dinheiro.

## Requisitos derivados
- Plano de contas padronizado (sem texto livre) com centros de custo: **unidade × veículo × linha de negócio** (passeios regulares, transporte B2B, grupos/escolas, fretamento, publicidade, revenda).
- Fechamento de caixa diário no sistema, com conferência e bloqueio após fechado.
- Conciliação automática: venda → comissão do canal → valor líquido → data prevista × data recebida.
- Contratos B2B recorrentes (Oceanic, publicidade) com faturamento mensal e reajuste.
- Exportação para a contabilidade; emissão de NFS-e pelo Emissor Nacional.

## Planilha de controle (estrutura, 05/11/2026)
- Uma aba por mês (ex.: AGO, SET, OUT) e uma consolidada "jan a out". Cabeçalho na linha 4 (consolidada) ou 14 (meses); acima dele há um resumo por grupo (RECEITA por banco, TAXAS, FROTA, FIXO, TRIBUTOS, PESSOAL, POSTO, ADM, RH, RESULTADO) cujas fórmulas e saldos estão errados desde a troca de layout (colunas trocadas, RH de BC fora do RH, POSTO somado duas vezes, RESULTADO sem a receita de um banco). O sistema não importa o resumo e recalcula tudo.
- Colunas: MÊS, CONTA (SIC, UNI, DIN = dinheiro do quiosque, AGE = agenda sem valor, "U/S"), DATA, GRUPO, CAT, FORNECEDOR, DESCRIÇÃO, valores, OBS (às vezes com CPF/CNPJ, e-mail ou telefone do favorecido). A linha "AAA SALDO" é o saldo de abertura de cada conta naquela aba.
- Layout antigo: A PAGAR, SAÍDA SIC (positivo = saída), ENTR SIC, CARTÃO, UNILOS (o sinal dá a direção). Layout novo (a partir de OUT/2026): A PAGAR, SICREDI, UNILOS, QUIOSQUE, CARTÃO, com saídas negativas.
- Grupos (com erros de digitação): RECEITA, FROTA, RH (e RH - BC), FIXO, ADM, PESSOAL, TAXAS, IMPOSTOS, POSTO, AGENDA, APLICAÇÃO, QUIO. Ficam fora do resultado operacional: transferências entre contas, aplicação e resgate, empréstimos (entrada = passivo; parcela = amortização + juros) e pessoal. Devoluções e estornos abatem a origem. A empresa também revende serviços de terceiros (ex.: ingressos), com a comissão do vendedor lançada no RH.
- Há **um só caixa em dinheiro**: a "caixinha" é o caixa do quiosque. Os dados reais da planilha entram só em produção.
