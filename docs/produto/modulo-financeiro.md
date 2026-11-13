# Módulo Financeiro (MVP) — 04/11/2026

Referência de ideias: APP TOMA (contas a pagar/receber, conciliação, cartão e travas), adaptadas ao turismo e à nossa stack. Base do negócio: `docs/conhecimento/financeiro.md`.

## O que faz
- **Contas financeiras:** corrente, aplicação, caixa (quiosque) e cartão de crédito (dia de fechamento e de vencimento, conta que paga a fatura). Só os últimos dígitos da conta/cartão são guardados. Saldo = saldo inicial + movimento do extrato (todas as linhas) + lançamentos baixados que não estão ligados a uma linha **e** não caem no período de um extrato importado da conta (caixa do quiosque, por exemplo); assim baixa manual e linha do mesmo movimento nunca contam em dobro. A data do saldo inicial vale no **início** do dia: movimentos daquela data em diante entram (>=).
- **Categorias:** plano inicial de turismo criado automaticamente na primeira consulta (receitas: site/Paytour, quiosque, Viator, Decolar, Civitatis, fretamento, publicidade, recreativo, rendimentos, outras; despesas: combustível, manutenção, pedágio/estacionamento, diárias, salários, comissões de afiliados/OTAs, taxas de cartão/gateway, marketing, aluguel, seguros, impostos, outras). Cada categoria tem um grupo que forma as linhas da DRE. Categorias do plano só se desativam; novas podem ser criadas.
- **Centro de custo:** praça (unidade) × linha de negócio (CITY_TOUR, FRETAMENTO, PUBLICIDADE, RECREATIVO) × veículo opcional (placa em texto).
- **Contas a pagar e a receber** (uma tabela, `tipo`): competência, vencimento, valor em centavos, forma, conta, canal (receitas), parcelas (divisão sem perda de centavos: as primeiras parcelas recebem o resto), recorrência mensal, situação ABERTO ou REALIZADO, **baixa** com juros, multa e desconto (valor pago = valor + juros + multa − desconto), reabertura e exclusão de uma série em aberto.
- **Importação de extrato** OFX (1.x e 2.x) e CSV simples (Data, Descrição, Valor ou Crédito/Débito; separador `;` ou `,`); **fatura de cartão** em CSV (compras positivas viram saídas) ou OFX. Prévia sem gravar, depois confirmação. Não duplica: FITID do banco; sem FITID, identificador derivado de data + valor + descrição + ordem de ocorrência no arquivo (duas compras iguais no mesmo dia continuam distintas e reimportar o mesmo arquivo não cria nada). PDF fica para depois.
- **Regras de categorização por texto:** só **sugerem** categoria (a de texto mais específico vence, respeitando entrada/saída).
- **Conciliação:** sugestões por valor exato/aproximado (até 10%), proximidade de data e nome; confirmar, recusar (a recusa nunca volta para aquela linha), lançar a partir da linha (cria o lançamento já baixado e conciliado), ignorar e desfazer. **Nada concilia sozinho.** Diferença de valor exige destino explícito (juros, multa ou desconto), nunca arredondada. Transferência entre contas: lançada à mão (duas pontas pareadas) ou pareando duas linhas importadas; não entra em receita/despesa.
- **Travas:** lançamento conciliado não muda valor, datas nem conta e não é excluído nem reaberto; baixado não muda valor nem é excluído (reabra antes); linha já decidida não é decidida de novo (também sob concorrência); data de baixa/transferência não pode ser futura.
- **Cartões:** faturas por ciclo (compras até o fechamento entram na fatura do mês), total, compras sem classificar e "Pagar fatura" (transferência da conta pagadora para o cartão).
- **Fluxo de caixa e cartão:** lançamentos de contas de cartão não entram no fluxo (a compra não sai do caixa); sai do caixa o pagamento da fatura (transferência da conta para o cartão), na data em que foi pago.
- **Regras:** criar/editar valida categoria, tipo (compatível com a categoria; regra sem tipo vale pelo tipo da categoria) e praça; regra geral (sem praça) só é criada/editada por quem vê todas as praças.
- **Resumo:** a pagar/receber do mês (por vencimento), vencidas, saldo das contas, fluxo de caixa semanal (4 semanas atrás, 8 à frente; realizado pela data da baixa, previsto pelo vencimento, vencidas na semana atual, saldo projetado) e **DRE gerencial** por competência (por grupo/categoria, juros/multas/descontos à parte, resultado e margem em pontos-base inteiros) e por praça × linha.

## Planilha de controle financeiro (importador, 05/11/2026)
Estrutura da planilha "DESP FIXA" da empresa (só a estrutura; **nenhum dado real** vai para o repositório, os testes ou as demonstrações).

**O que o sistema entende**
- Uma aba por vez, exportada em **CSV** (o .xlsx não é lido: nenhum pacote novo foi adicionado; no Google Sheets, *Arquivo › Fazer download › Valores separados por vírgula*). O cabeçalho é achado pelos nomes das colunas (MÊS, CONTA, DATA, GRUPO, CAT, FORNECEDOR, DESCRIÇÃO, valores, OBS), em qualquer linha (4 ou 14, por exemplo). O resumo do topo e os saldos da planilha têm fórmulas erradas e **não são importados**: o sistema recalcula tudo.
- **Dois layouts**, detectados pelo cabeçalho: *novo* (A PAGAR, SICREDI, UNILOS, QUIOSQUE, CARTÃO; saídas negativas em cada conta) e *antigo* (A PAGAR, SAÍDA SIC e ENTR SIC positivos, CARTÃO, UNILOS; o Sicredi vira entrada − saída). Coluna de conta: DIN = caixa em dinheiro (um só caixa, o do quiosque), AGE = agenda (ignorada, sem lançamento).
- **Dicionário de sinônimos editável** (tabela `fin_sinonimos`, tela *Contas e categorias*): grupos (FOTA→FROTA, RECEIRA→RECEITA, PESS→PESSOAL, TAXA→TAXAS, IMPOSTO/TRIBUTOS→IMPOSTOS, RH - BC→RH…) e categorias no formato `GRUPO|CATEGORIA` (`*` vale para qualquer grupo; `GRUPO|*` é o padrão do grupo). Semeado uma vez; o que a pessoa editar ou apagar não volta. Reservas por palavra: TRANSF/TRANF/TRANS ENTRE, APLICA/RESGATE e EMPRESTIMO/EPRESTIMO/CAPITAL DE GIRO.
- **Plano de categorias** espelha os grupos da planilha: Receita, Outras receitas, Taxas, Frota, Posto, Fixo, Tributos, RH, Administrativo; mais os grupos à parte abaixo. POSTO BC tem categoria própria de combustível.

**O que fica fora da operação (DRE)**
- Transferências entre contas, aplicações e resgates (movimento com a conta *Aplicação*, tipo investimento): linhas de extrato pareadas, nunca receita nem despesa.
- **Empréstimos** tomados e pagos: grupo "Empréstimos (fora do resultado)" (entrada = passivo; parcela = amortização + juros). Juros, IOF e tarifas continuam como despesa financeira (Taxas). A divisão da parcela entre amortização e juros é manual, pelo lançamento.
- **Devoluções e estornos**: grupo próprio que abate a receita ou a despesa de origem (devolução paga reduz receita; recebida reduz despesa). Linha com sinal contrário ao da categoria vai para a contrapartida certa.
- **Pessoal** ("Pessoal (despesas pessoais pagas pela empresa)"): fora do resultado operacional e mostrado à parte; o resultado "após despesas pessoais" também é calculado. A prévia avisa quando uma linha cita CPF (cartão, consórcio ou conta de pessoa física); nada é reclassificado sozinho.
- **Revenda de terceiros** (ex.: ingressos): ver abaixo.

**Prévia (nada é gravado) e confirmação**
- Mostra layout, contagens, contas que serão criadas (Sicredi, Unilos, Quiosque, Cartão, Aplicação, sem números de conta), entradas e saídas por conta, saldos de abertura e amostra.
- **Conferência de qualidade**, sempre com contagem e linhas: data vazia ou inválida (ex.: "03/06" sem ano, "31/082026": a linha fica de fora), mês da coluna A diferente da data, ano fora do período, grupo vazio (a classificar), grafias diferentes, **possíveis duplicadas** (mesma data + favorecido + conta + valor: só "verificar", nada é descartado; diárias e contratos mensais iguais são legítimos), A PAGAR ≠ valor pago (a diferença vira **desconto ou juros** na baixa), lançamentos futuros só em A PAGAR (viram contas a pagar previstas, em aberto) e valor só em A PAGAR sem conta.
- **Não reconhecidos**: lista cada combinação grupo|categoria desconhecida; mapeie para uma categoria, para transferência ou ignore, atualize a prévia e (opcional) lembre no dicionário.
- A confirmação grava tudo numa transação: lançamentos baixados na conta da coluna preenchida (data = data da linha), A PAGAR sem conta = conta a pagar em aberto, transferências pareadas e saldos iniciais. **Idempotente**: cada linha tem uma chave estável (coluna + data + valor + grupo + categoria + favorecido + descrição + ordem de ocorrência); reimportar a mesma aba não duplica. Linha com erro de valor bloqueia a confirmação.
- **OBS com CPF/CNPJ, e-mail ou telefone** nunca vai para a descrição: vira dado do favorecido (`fin_fornecedores`, contato **cifrado**), lido só por quem tem `financeiro:ver` (`GET /api/financeiro/fornecedores/:id`), e jamais em log, auditoria ou resposta de prévia. A auditoria guarda só contagens.
- A placa do veículo achada na descrição (grupos Frota e Posto) vai para o campo veículo.

**Saldos**
- A linha "AAA SALDO" da **primeira** aba importada vira o saldo inicial da conta (na data da linha, ou do primeiro lançamento). Nas abas seguintes o sistema **compara** com o saldo que ele mesmo calculou no início daquela data e mostra a **divergência a conferir**, sem sobrescrever.
- Resumo financeiro: quadro de saldos (bancos, caixa em dinheiro, aplicação, total disponível; cartões à parte) e "Resumo do mês, como na planilha" (receita por conta, despesas por grupo, RESULTADO e resultado após pessoal). A aba **Caixa e saldos** mostra o saldo dia a dia de qualquer conta (até 120 dias).
- Saldo = saldo inicial + movimento do extrato (inclusive transferências) + lançamentos baixados sem linha e fora do período de extrato importado (regra descrita acima).

**Caixa em dinheiro (quiosque)**: uma só conta de tipo CAIXA (coluna QUIOSQUE/DIN). O *fechamento do dia* é simples: saldo inicial, entradas, saídas, saldo contado e diferença (um por conta e dia; tabela `fin_fechamentos_caixa`). Depois de fechado, baixas e reaberturas naquela data no caixa ficam bloqueadas (a importação da planilha não passa por essa trava).

**Revenda de terceiros** (aba *Revenda*, tabela `fin_revendas`): a venda (valor recebido do cliente), o repasse ao fornecedor e a comissão do vendedor viram lançamentos em aberto (categorias "Revenda de terceiros" e "Comissões de pessoal"). Na DRE só a **margem** (venda − repasse) entra como receita própria, na linha "Revenda de terceiros (margem)"; a comissão aparece em RH. **Tratamento contábil a confirmar com o contador.**

**Ligação com a Frota**: no painel da frota, o custo por veículo soma também os lançamentos do financeiro dos grupos Frota e Posto com a placa do veículo (coluna "Financeiro", competência do mês), só para quem vê o financeiro. Atenção: se a mesma despesa estiver na ordem de manutenção ou no abastecimento **e** no financeiro, ela conta duas vezes (a confirmar a regra entre os módulos).

### Passo a passo para o dono importar a planilha real (no servidor, em produção)
Os dados reais entram **só em produção**; o desenvolvimento e os testes usam planilhas fictícias.
1. Entre com um usuário com `financeiro:gerenciar` (MFA ativo). Em *Contas e categorias*, clique em **Criar contas padrão** (Sicredi, Unilos, Quiosque, Cartão, Aplicação) para a praça; confira os dias de fechamento e vencimento do cartão.
2. Na planilha, exporte **uma aba por vez** como CSV, **começando pela mais antiga** (a primeira define os saldos iniciais). O .xlsx ainda não é lido.
3. Em *Financeiro › Importar planilha*, escolha a praça e o arquivo. Confira a prévia: layout, contas, saldos de abertura e a conferência de qualidade (corrija na planilha o que for data inválida ou duplicidade de verdade e exporte de novo).
4. Mapeie o que não foi reconhecido (categoria, transferência ou ignorar) e marque *Lembrar no dicionário*. Clique em *Atualizar prévia* até a lista de não reconhecidos zerar (ou aceite ignorar essas linhas).
5. Confirme. Repita para as abas seguintes; o aviso de **divergência de saldo** mostra se o saldo de abertura da aba bate com o calculado (não sobrescreve nada).
6. Se importar a mesma aba de novo (por correção), nada duplica: só entram as linhas novas.
7. Confira o **Resumo financeiro** do mês e compare com o resumo da planilha, lembrando que as fórmulas dela têm erros conhecidos.

## Permissões e escopo
- `financeiro:ver` e `financeiro:gerenciar`, ambas **sensíveis** (exigem MFA). `gerenciar` também permite consultar na API; na tela o menu usa `financeiro:ver`, então dê as duas ao perfil que lança.
- Escopo por praça: quem não vê todas as praças só enxerga contas, lançamentos e extratos das suas; registros "da empresa toda" (sem praça) só aparecem para quem vê todas. Praça obrigatória para quem não é de todas.
- Toda gravação gera auditoria (`FIN_*`), sem dado pessoal.

## Telas (`apps/web/src/paginas/financeiro/`)
Abas Resumo (`/financeiro`), A pagar, A receber, Extrato e conciliação, Cartões, Caixa e saldos, Revenda, Importar planilha, Contas e categorias (com o dicionário de sinônimos). No menu Administrativo, os itens planejados Contas a pagar/receber/Cartões viraram itens reais (e atalho `g d` para o resumo).

## Banco e API
Tabelas em `apps/api/src/db/esquemas/financeiro.ts`: `fin_contas`, `fin_categorias`, `fin_lancamentos`, `fin_extratos`, `fin_extrato_linhas`, `fin_recusas`, `fin_regras`, `fin_fornecedores`, `fin_sinonimos`, `fin_fechamentos_caixa`, `fin_revendas` (e as colunas `fornecedor_id` e `chave_importacao` em `fin_lancamentos`). Dinheiro em `bigint` (centavos). Migração **não commitada** (gerada na junção). Rotas `/api/financeiro/*` em `rotas/financeiro.ts` e `rotas/financeiro-extrato.ts`; regras puras em `packages/core/src/financeiro/`.
Observação técnica: para gerar a migração, `drizzle-kit` não resolve imports `.js` entre arquivos de esquema (o arquivo `esquemas/financeiro.ts` importa `../schema.js` e o `schema.ts` o reexporta); basta gerar com os sufixos `.js` removidos temporariamente nesses dois imports.

## Decisões
- Plano de categorias semeado de forma preguiçosa e idempotente (`garantirPlano`), sem alterar o seed compartilhado.
- Um lançamento concilia com **uma** linha (relação 1:1, índice único); conciliar várias linhas ao mesmo lançamento ou uma linha a várias contas (ex.: fatura de cartão paga como soma) fica para depois.
- Desfazer conciliação: lançamento criado do extrato é removido; só se a baixa foi feita pela própria conciliação (campo `baixa_da_conciliacao` na linha) o lançamento volta a "em aberto"; baixa manual anterior é preservada.
- Vencimento da fatura é sempre posterior ao fechamento (se o dia cair igual ou antes, passa ao mês seguinte).

## Pendências e a confirmar
- Reservas de abastecimento e diária do caixa do quiosque; leitura direta de .xlsx (hoje só CSV); tela de consulta de favorecidos (a API existe); amortização × juros da parcela de empréstimo; ligação automática da comissão do vendedor à venda importada; conciliar custo de frota lançado no financeiro com ordens e abastecimentos do módulo de frota.
- Conciliação de recebíveis por canal (Paytour, OTAs: bruto, comissão, líquido, previsto × efetivo) e integração com vendas.
- Contratos B2B recorrentes com reajuste (Oceanic, publicidade).
- Fiscal: NFS-e, ISS, guias, Reforma Tributária (CBS/IBS) e exportação para o contador.
- Orçamento anual; fatura de cartão em PDF; conciliação 1:N; anexos (NF, boletos).
- A confirmar com o dono: categorias/grupos da DRE; regime tributário; se contas "da empresa toda" devem aparecer para gerentes de praça; limite de tolerância de 10% para sugestão aproximada; perfil padrão "Financeiro" (não criado; ADMIN já recebe tudo).
- Dados bancários reais nunca em testes/repositório; os testes usam dados fictícios.

## Aba DRE (10/11/2026)
Estrutura, decisões e o que ficou "a confirmar": ver `docs/conhecimento/financeiro.md` (seção DRE gerencial).
Cálculo em `packages/core/src/financeiro/dre.ts` (`montarDreGerencial`, `SECOES_DRE`, `GRUPOS_DA_SECAO`); rota `GET /api/financeiro/dre?ano&regime&unidadeId&linha`.
Categoria nova escolhe o grupo numa lista com as linhas da DRE (não é mais texto livre).

## Filtros de coluna e saldo da conta (dono, 13/11/2026)
- Em **A pagar** e **A receber**, cada cabeçalho da tabela abre um menu como no Excel: **Classificar de A a Z / Z a A** (datas:
  mais antigo/mais recente; valor: menor/maior), busca e caixinhas para marcar só os valores desejados (ex.: só a placa de um
  ônibus ou o trem). Vale sobre os lançamentos do mês carregados na tela; com filtro de coluna ativo, o rodapé mostra quantos
  aparecem e a soma deles.
- A coluna **Centro de custo** (praça · linha · veículo/placa/trem) passou para logo depois do Vencimento e aparece também no celular.
- Ao escolher o **banco/conta** nos filtros, o topo mostra, para aquela conta: recebido no mês, pago no mês, **resultado do mês**
  (recebido − pago) e o **saldo atual** da conta (saldo inicial + tudo o que já entrou e saiu, o mesmo de Caixa e saldos).
