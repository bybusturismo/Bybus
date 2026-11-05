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

## Planilha de controle financeiro "DESP FIXA BY BUS" (estrutura, auditada em 05/11/2026)
- Abas por mês (AGO2026, SET2026, OUT2026) e uma aba anual "jan a out". Contas: Sicredi, Unilos, dinheiro do quiosque (caixa) e cartões.
- Dois layouts: até setembro `A PAGAR | SAIDA SIC | ENTR SIC | CARTÃO | UNILOS`; em outubro `A PAGAR | SICREDI | UNILOS | QUIOSQUE | CARTÃO` (saídas negativas). As fórmulas do resumo não foram atualizadas para o layout novo (a própria planilha anota "mudar as formulas").
- Achados da auditoria (detalhe em conversa com o dono, só agregados): resumo com colunas trocadas, RH-BC fora do RH, combustível somado em FROTA e em POSTO, RESULTADO sem a receita da Unilos; transferências, aplicações/resgates e empréstimos misturados com receita/despesa; despesas pessoais junto das da empresa; abril e maio sem receitas lançadas na aba anual; outubro colado na aba anual sem grupo; datas inválidas e lançamentos futuros (previsões) misturados.
- **Revenda de serviços de terceiros:** a By Bus revende, por exemplo, **ingressos do Beto Carrero** (comissão de vendedor em "COMISSÃO BETO CARREIRO"). Tratamento contábil (receita = só a margem/comissão) a confirmar com o contador.
