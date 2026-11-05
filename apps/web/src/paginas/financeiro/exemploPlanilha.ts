/** Planilha FICTÍCIA no formato do controle financeiro (layout novo), para experimentar a importação sem dados reais. */
export const EXEMPLO_PLANILHA = [
  "CONTROLE FINANCEIRO - EXEMPLO FICTICIO,,,,,,,,,,,,",
  "RESUMO DO MES (o sistema recalcula),,,,,,,,,,,,",
  "MÊS,CONTA,DATA,,CAT,FORNECEDOR,DESCRIÇÃO, A PAGAR , SICREDI , UNILOS , QUIOSQUE , CARTÃO ,OBS",
  'OUT,,,,AAA SALDO,,,,"R$  10.000,00","R$  5.000,00","R$  300,00",,',
  'OUT,SIC,02/10/2026,RECEITA,CLIENTE,Empresa Exemplo,Fretamento de outubro,,"R$  5.000,00",,,,',
  'OUT,SIC,05/10/2026,FOTA,MANUTENÇÃO,Oficina Exemplo,Revisão ABC-1D23,,"R$  (1.500,00)",,,,CNPJ 00.000.000/0001-00 contato@exemplo.invalid',
  'OUT,SIC,06/10/2026,FROTA,POSTO,Posto Exemplo,Diesel ABC-1D23,,"R$  (800,25)",,,,',
  'OUT,UNI,07/10/2026,RH - BC,FOLHA CLT,,Folha de outubro,,,"R$  (2.000,00)",,,',
  'OUT,SIC,08/10/2026,ADM,TRANS ENTRE CONTAS,,Sicredi para Unilos,,"R$  (1.000,00)","R$  1.000,00",,,',
  'OUT,DIN,09/10/2026,QUIO,RECEITA,,Vendas do quiosque em dinheiro,,,,"R$  250,00",,',
  'OUT,DIN,09/10/2026,QUIO,DESPESA,,Gelo,,,,"R$  (40,00)",,',
  'OUT,,10/10/2026,FIXO,CONSORCIO,Consórcio Exemplo,Parcela de outubro,"R$  (900,00)",,,,,',
  'OUT,SIC,11/10/2026,PESS,DESP DIRETA,,Despesa pessoal de exemplo,,"R$  (150,00)",,,,',
  'OUT,SIC,13/10/2026,AGENDA,LEMBRETE,,Item que o sistema não reconhece,,"R$  (10,00)",,,,',
].join("\n");
