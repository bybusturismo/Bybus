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

## Planilha de controle (estrutura, 05/11/2026)
- Uma aba por mês (ex.: AGO, SET, OUT) e uma consolidada "jan a out". Cabeçalho na linha 4 (consolidada) ou 14 (meses); acima dele há um resumo por grupo (RECEITA por banco, TAXAS, FROTA, FIXO, TRIBUTOS, PESSOAL, POSTO, ADM, RH, RESULTADO) cujas fórmulas e saldos estão errados desde a troca de layout (colunas trocadas, RH de BC fora do RH, POSTO somado duas vezes, RESULTADO sem a receita de um banco). O sistema não importa o resumo e recalcula tudo.
- Colunas: MÊS, CONTA (SIC, UNI, DIN = dinheiro do quiosque, AGE = agenda sem valor, "U/S"), DATA, GRUPO, CAT, FORNECEDOR, DESCRIÇÃO, valores, OBS (às vezes com CPF/CNPJ, e-mail ou telefone do favorecido). A linha "AAA SALDO" é o saldo de abertura de cada conta naquela aba.
- Layout antigo: A PAGAR, SAÍDA SIC (positivo = saída), ENTR SIC, CARTÃO, UNILOS (o sinal dá a direção). Layout novo (a partir de OUT/2026): A PAGAR, SICREDI, UNILOS, QUIOSQUE, CARTÃO, com saídas negativas.
- Grupos (com erros de digitação): RECEITA, FROTA, RH (e RH - BC), FIXO, ADM, PESSOAL, TAXAS, IMPOSTOS, POSTO, AGENDA, APLICAÇÃO, QUIO. Ficam fora do resultado operacional: transferências entre contas, aplicação e resgate, empréstimos (entrada = passivo; parcela = amortização + juros) e pessoal. Devoluções e estornos abatem a origem. A empresa também revende serviços de terceiros (ex.: ingressos), com a comissão do vendedor lançada no RH.
- Há **um só caixa em dinheiro**: a "caixinha" é o caixa do quiosque. Os dados reais da planilha entram só em produção.

## Pendências de categoria (pedido do dono, 09/11/2026)
- Na importação, o que fica como **"não importar ainda"** é guardado em **Financeiro › Pendências** (a aba fica cifrada no banco só enquanto houver pendência).
- Ao escolher a categoria lá, as linhas entram sem importar a aba de novo; o resto da aba não duplica. Resolvido tudo, a cópia da aba é apagada.
- Importações feitas antes desta função não guardaram as pendências: para essas abas, importar mais uma vez (o que já entrou não duplica).

## Importar pelo link do Google (09/11/2026)
- Financeiro › Importar planilha › "Ou pelo link do Google Sheets": cola o link, escolhe a aba e segue a mesma prévia (nada duplica).
- O servidor lê com uma **conta de serviço** do Google (só leitura de planilhas); a planilha continua privada e é compartilhada como **Leitor**
  só com o e-mail dessa conta. Chave só no `.env` do servidor (`GOOGLE_CONTA_SERVICO`, via `implantacao/ligar-google.sh`).

## DRE gerencial (aba Financeiro › DRE, decisão do dono em 10/11/2026)
- O dono pediu a sugestão do especialista e aprovou a estrutura: Receita bruta → (−) Deduções (impostos sobre o faturamento,
  cancelamentos) = Receita líquida → (−) Custos de venda (comissões de OTAs/agências, taxas de cartão e gateway, afiliados,
  comissão de vendedores, repasse do trenzinho) = **Margem de contribuição** → (−) Custos da operação (combustível, diárias e
  terceirizados, manutenção e peças, viagem e deslocamento) = Lucro bruto → (−) Frota fixa, Pessoal fixo, Administrativo e comercial
  = **Resultado operacional (EBITDA)** → (+/−) Resultado financeiro (rendimentos, juros, tarifas, IOF) = **Resultado líquido**.
- **Abaixo da linha** (mexe no caixa, não é lucro): empréstimos (entrada e parcelas), investimentos (consórcio, compra de veículos),
  retirada dos sócios e despesas pessoais pagas pela empresa.
- Respostas assumidas: regime tributário **a confirmar** com o contador (linha genérica "Impostos sobre o faturamento");
  trenzinho = venda inteira como receita + repasse de 50% à TOMA como custo de venda; consórcio = investimento (a confirmar se é
  de veículo); juros de empréstimo, quando separados da parcela, vão para "Juros de empréstimos"; depreciação fica para depois.
- Visões: competência (padrão) ou caixa; filtro por praça e linha de negócio; 12 meses + acumulado + % da receita bruta;
  clique no valor de uma categoria mostra os lançamentos.
- Os códigos das categorias não mudaram (nada foi reclassificado no banco): mudaram nome, grupo e ordem. As peças antigas
  (alternador, radiador, toldo) ficam dentro de "Manutenção e peças". Categorias novas: grupos, trenzinho, repasse do trenzinho,
  pró-labore, sistemas, outros impostos, juros, tarifas, compra de veículos, retirada dos sócios.
- O quadro "Resumo do mês, como na planilha" saiu do Resumo (usava os grupos antigos); a aba DRE o substitui.

## Desfazer importação (pedido do dono, 10/11/2026)
- Financeiro › Importar planilha › **Importações feitas**: cada importação aparece com data, aba, praça, quem fez e quantos
  lançamentos/transferências criou, com o botão **Desfazer** (com confirmação e registro na auditoria).
- Desfazer apaga os lançamentos e as transferências daquela importação e volta o saldo inicial que ela trocou (se ninguém
  mudou depois). Lançamentos já conciliados com o extrato ou usados numa revenda ficam (aparecem como "mantidos").
  Contas criadas, fornecedores e sinônimos aprendidos não mudam.
- As importações feitas antes desta função aparecem como "anterior": foram reconstituídas pela hora em que foram gravadas
  (migração 0038), e também podem ser desfeitas.
