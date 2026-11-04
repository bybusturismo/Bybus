# Módulo Financeiro (MVP) — 04/11/2026

Referência de ideias: APP TOMA (contas a pagar/receber, conciliação, cartão e travas), adaptadas ao turismo e à nossa stack. Base do negócio: `docs/conhecimento/financeiro.md`.

## O que faz
- **Contas financeiras:** corrente, aplicação, caixa (quiosque) e cartão de crédito (dia de fechamento e de vencimento, conta que paga a fatura). Só os últimos dígitos da conta/cartão são guardados. Saldo = saldo inicial + movimento do extrato + lançamentos baixados que não vieram de extrato (caixa); se há "saldo válido em", só entra o que for posterior.
- **Categorias:** plano inicial de turismo criado automaticamente na primeira consulta (receitas: site/Paytour, quiosque, Viator, Decolar, Civitatis, fretamento, publicidade, recreativo, rendimentos, outras; despesas: combustível, manutenção, pedágio/estacionamento, diárias, salários, comissões de afiliados/OTAs, taxas de cartão/gateway, marketing, aluguel, seguros, impostos, outras). Cada categoria tem um grupo que forma as linhas da DRE. Categorias do plano só se desativam; novas podem ser criadas.
- **Centro de custo:** praça (unidade) × linha de negócio (CITY_TOUR, FRETAMENTO, PUBLICIDADE, RECREATIVO) × veículo opcional (placa em texto).
- **Contas a pagar e a receber** (uma tabela, `tipo`): competência, vencimento, valor em centavos, forma, conta, canal (receitas), parcelas (divisão sem perda de centavos: as primeiras parcelas recebem o resto), recorrência mensal, situação ABERTO ou REALIZADO, **baixa** com juros, multa e desconto (valor pago = valor + juros + multa − desconto), reabertura e exclusão de uma série em aberto.
- **Importação de extrato** OFX (1.x e 2.x) e CSV simples (Data, Descrição, Valor ou Crédito/Débito; separador `;` ou `,`); **fatura de cartão** em CSV (compras positivas viram saídas) ou OFX. Prévia sem gravar, depois confirmação. Não duplica: FITID do banco; sem FITID, identificador derivado de data + valor + descrição + ordem de ocorrência no arquivo (duas compras iguais no mesmo dia continuam distintas e reimportar o mesmo arquivo não cria nada). PDF fica para depois.
- **Regras de categorização por texto:** só **sugerem** categoria (a de texto mais específico vence, respeitando entrada/saída).
- **Conciliação:** sugestões por valor exato/aproximado (até 10%), proximidade de data e nome; confirmar, recusar (a recusa nunca volta para aquela linha), lançar a partir da linha (cria o lançamento já baixado e conciliado), ignorar e desfazer. **Nada concilia sozinho.** Diferença de valor exige destino explícito (juros, multa ou desconto), nunca arredondada. Transferência entre contas: lançada à mão (duas pontas pareadas) ou pareando duas linhas importadas; não entra em receita/despesa.
- **Travas:** lançamento conciliado não muda valor, datas nem conta e não é excluído nem reaberto; baixado não muda valor nem é excluído (reabra antes); linha já decidida não é decidida de novo (também sob concorrência); data de baixa/transferência não pode ser futura.
- **Cartões:** faturas por ciclo (compras até o fechamento entram na fatura do mês), total, compras sem classificar e "Pagar fatura" (transferência da conta pagadora para o cartão).
- **Resumo:** a pagar/receber do mês (por vencimento), vencidas, saldo das contas, fluxo de caixa semanal (4 semanas atrás, 8 à frente; realizado pela data da baixa, previsto pelo vencimento, vencidas na semana atual, saldo projetado) e **DRE gerencial** por competência (por grupo/categoria, juros/multas/descontos à parte, resultado e margem em pontos-base inteiros) e por praça × linha.

## Permissões e escopo
- `financeiro:ver` e `financeiro:gerenciar`, ambas **sensíveis** (exigem MFA). `gerenciar` também permite consultar na API; na tela o menu usa `financeiro:ver`, então dê as duas ao perfil que lança.
- Escopo por praça: quem não vê todas as praças só enxerga contas, lançamentos e extratos das suas; registros "da empresa toda" (sem praça) só aparecem para quem vê todas. Praça obrigatória para quem não é de todas.
- Toda gravação gera auditoria (`FIN_*`), sem dado pessoal.

## Telas (`apps/web/src/paginas/financeiro/`)
Abas Resumo (`/financeiro`), A pagar, A receber, Extrato e conciliação, Cartões, Contas e categorias. No menu Administrativo, os itens planejados Contas a pagar/receber/Cartões viraram itens reais (e atalho `g d` para o resumo).

## Banco e API
Tabelas em `apps/api/src/db/esquemas/financeiro.ts`: `fin_contas`, `fin_categorias`, `fin_lancamentos`, `fin_extratos`, `fin_extrato_linhas`, `fin_recusas`, `fin_regras`. Dinheiro em `bigint` (centavos). Migração **não commitada** (gerada na junção). Rotas `/api/financeiro/*` em `rotas/financeiro.ts` e `rotas/financeiro-extrato.ts`; regras puras em `packages/core/src/financeiro/`.
Observação técnica: para gerar a migração, `drizzle-kit` não resolve imports `.js` entre arquivos de esquema (o arquivo `esquemas/financeiro.ts` importa `../schema.js` e o `schema.ts` o reexporta); basta gerar com os sufixos `.js` removidos temporariamente nesses dois imports.

## Decisões
- Plano de categorias semeado de forma preguiçosa e idempotente (`garantirPlano`), sem alterar o seed compartilhado.
- Um lançamento concilia com **uma** linha (relação 1:1, índice único); conciliar várias linhas ao mesmo lançamento ou uma linha a várias contas (ex.: fatura de cartão paga como soma) fica para depois.
- Desfazer conciliação: lançamento criado do extrato é removido; lançamento baixado pela conciliação volta a "em aberto"; baixa manual anterior é preservada.

## Pendências e a confirmar
- Fechamento de caixa diário do balcão (caixa/quiosque) e reservas de abastecimento/diária — próxima etapa.
- Conciliação de recebíveis por canal (Paytour, OTAs: bruto, comissão, líquido, previsto × efetivo) e integração com vendas.
- Contratos B2B recorrentes com reajuste (Oceanic, publicidade).
- Fiscal: NFS-e, ISS, guias, Reforma Tributária (CBS/IBS) e exportação para o contador.
- Orçamento anual; fatura de cartão em PDF; conciliação 1:N; anexos (NF, boletos).
- A confirmar com o dono: categorias/grupos da DRE; regime tributário; se contas "da empresa toda" devem aparecer para gerentes de praça; limite de tolerância de 10% para sugestão aproximada; perfil padrão "Financeiro" (não criado; ADMIN já recebe tudo).
- Dados bancários reais nunca em testes/repositório; os testes usam dados fictícios.
