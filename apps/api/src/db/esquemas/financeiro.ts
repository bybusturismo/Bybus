import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
// Referências às tabelas de outros módulos ficam em funções (`() => unidades.id`) para não depender da ordem de carga.
import { unidades, usuarios } from "../schema.js";

const agora = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** Dinheiro: sempre centavos inteiros (bigint como number: seguro até 2^53). */
const centavos = () => bigint({ mode: "number" });

/** Contas financeiras: corrente, aplicação, caixa (quiosque) e cartão de crédito. `unidadeId` nulo = empresa toda. */
export const finContas = pgTable("fin_contas", {
  id: uuid().primaryKey().defaultRandom(),
  unidadeId: uuid().references(() => unidades.id),
  nome: text().notNull(),
  /** CORRENTE, APLICACAO, CAIXA ou CARTAO. */
  tipo: text().notNull(),
  banco: text(),
  /** Só os últimos dígitos da conta/cartão (nunca o número completo). */
  finalConta: text(),
  saldoInicialCentavos: centavos().notNull().default(0),
  saldoInicialEm: date(),
  /** Cartão: dia do fechamento e do vencimento da fatura; conta corrente que paga a fatura. */
  diaFechamento: integer(),
  diaVencimento: integer(),
  contaPagamentoId: uuid(),
  ativa: boolean().notNull().default(true),
  criadoEm: agora(),
}, (t) => [index("fin_contas_unidade_idx").on(t.unidadeId)]);

/** Plano de categorias (sem texto livre). `grupo` agrupa as linhas da DRE gerencial. */
export const finCategorias = pgTable("fin_categorias", {
  id: uuid().primaryKey().defaultRandom(),
  codigo: text().notNull().unique(),
  nome: text().notNull(),
  /** RECEITA ou DESPESA. */
  tipo: text().notNull(),
  grupo: text().notNull(),
  ordem: integer().notNull().default(100),
  ativa: boolean().notNull().default(true),
  /** Categorias do plano inicial (não podem ser excluídas, só desativadas). */
  sistema: boolean().notNull().default(false),
  criadoEm: agora(),
});

/** Favorecidos. CPF/CNPJ, e-mail e telefone ficam cifrados em `contatoCifrado` e só saem para quem tem financeiro:ver. */
export const finFornecedores = pgTable("fin_fornecedores", {
  id: uuid().primaryKey().defaultRandom(),
  nome: text().notNull(),
  nomeNormalizado: text().notNull().unique(),
  contatoCifrado: text(),
  criadoEm: agora(),
});

/** Dicionário de sinônimos da planilha (variações e erros de digitação → grupo/categoria certos). Editável. */
export const finSinonimos = pgTable("fin_sinonimos", {
  id: uuid().primaryKey().defaultRandom(),
  /** GRUPO ou CATEGORIA. */
  tipo: text().notNull(),
  texto: text().notNull(),
  alvo: text().notNull(),
  criadoEm: agora(),
}, (t) => [uniqueIndex("fin_sinonimos_uq").on(t.tipo, t.texto)]);

/**
 * Cada importação da planilha de controle (10/11/2026): permite desfazer pela tela.
 * ANTERIOR = importações feitas antes deste registro (reconstituídas pela hora da gravação).
 */
export const finImportacoes = pgTable("fin_importacoes", {
  id: uuid().primaryKey().defaultRandom(),
  unidadeId: uuid().references(() => unidades.id),
  arquivo: text(),
  /** PLANILHA, PENDENCIAS (categorias escolhidas depois) ou ANTERIOR. */
  origem: text().notNull().default("PLANILHA"),
  lancamentos: integer().notNull().default(0),
  transferencias: integer().notNull().default(0),
  /** Saldos iniciais que a importação trocou: { contaId, antes: {valor, em}, depois: {valor, em} } para voltar ao desfazer. */
  saldos: jsonb().$type<Array<{ contaId: string; antesCentavos: number | null; antesEm: string | null; depoisCentavos: number; depoisEm: string }>>().notNull().default(sql`'[]'::jsonb`),
  contasCriadas: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  criadoPor: uuid().references(() => usuarios.id),
  criadoEm: agora(),
  desfeitaEm: timestamp({ withTimezone: true }),
  desfeitaPor: uuid().references(() => usuarios.id),
  resultadoDesfazer: jsonb(),
}, (t) => [index("fin_importacoes_criado_idx").on(t.criadoEm)]);

/**
 * Contas a pagar e a receber (uma tabela, `tipo` PAGAR|RECEBER). Centro de custo = praça × linha de negócio × veículo.
 * Valores em centavos. Situação ABERTO ou REALIZADO (baixado, com juros/multa/desconto).
 */
export const finLancamentos = pgTable("fin_lancamentos", {
  id: uuid().primaryKey().defaultRandom(),
  tipo: text().notNull(),
  descricao: text().notNull(),
  /** Fornecedor/cliente/canal em texto livre (empresa, nunca dado pessoal de passageiro). */
  contraparte: text(),
  categoriaId: uuid().notNull().references(() => finCategorias.id),
  contaId: uuid().references(() => finContas.id),
  unidadeId: uuid().references(() => unidades.id),
  /** CITY_TOUR, FRETAMENTO, PUBLICIDADE ou RECREATIVO (nulo = não rateado). */
  linha: text(),
  /** Placa do veículo (texto). */
  veiculo: text(),
  /** Canal de venda (PAYTOUR, VIATOR…), para conciliar repasses. */
  canal: text(),
  forma: text(),
  valorCentavos: centavos().notNull(),
  competencia: date().notNull(),
  vencimento: date().notNull(),
  situacao: text().notNull().default("ABERTO"),
  pagoEm: date(),
  valorPagoCentavos: centavos(),
  jurosCentavos: centavos().notNull().default(0),
  multaCentavos: centavos().notNull().default(0),
  descontoCentavos: centavos().notNull().default(0),
  /** Parcelas e recorrência compartilham um grupo para localizar a série. */
  grupoId: uuid(),
  parcelaNumero: integer(),
  parcelaTotal: integer(),
  recorrente: boolean().notNull().default(false),
  observacao: text(),
  /** MANUAL (digitado), EXTRATO (criado de uma linha de extrato/fatura) ou PLANILHA (importado da planilha de controle). */
  origem: text().notNull().default("MANUAL"),
  /** Favorecido (fornecedor), com os dados de contato guardados cifrados à parte. */
  fornecedorId: uuid().references(() => finFornecedores.id),
  /** Identificador estável da linha da planilha: reimportar a mesma aba não duplica. */
  chaveImportacao: text(),
  /** Importação da planilha que criou o lançamento (para "Desfazer importação"). */
  importacaoId: uuid().references(() => finImportacoes.id, { onDelete: "set null" }),
  /** Cobrança de um grupo fechado (sinal ou saldo), 13/11/2026. Sem chave estrangeira para não criar ciclo entre os esquemas. */
  grupoFechadoId: uuid(),
  criadoPor: uuid().references(() => usuarios.id),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [
  index("fin_lanc_tipo_situacao_venc_idx").on(t.tipo, t.situacao, t.vencimento),
  index("fin_lanc_unidade_idx").on(t.unidadeId),
  index("fin_lanc_grupo_idx").on(t.grupoId),
  index("fin_lanc_competencia_idx").on(t.competencia),
  uniqueIndex("fin_lanc_chave_importacao_uq").on(t.chaveImportacao).where(sql`chave_importacao is not null`),
]);

/** Arquivos de extrato/fatura importados. */
export const finExtratos = pgTable("fin_extratos", {
  id: uuid().primaryKey().defaultRandom(),
  contaId: uuid().notNull().references(() => finContas.id),
  arquivo: text(),
  formato: text().notNull(),
  inicio: date(),
  fim: date(),
  saldoCentavos: centavos(),
  linhas: integer().notNull().default(0),
  novas: integer().notNull().default(0),
  repetidas: integer().notNull().default(0),
  importadoPor: uuid().references(() => usuarios.id),
  criadoEm: agora(),
}, (t) => [index("fin_extratos_conta_idx").on(t.contaId)]);

/** Linhas de extrato (valor com sinal). `idUnico` = FITID ou identificador sintético; único por conta (não duplica). */
export const finExtratoLinhas = pgTable("fin_extrato_linhas", {
  id: uuid().primaryKey().defaultRandom(),
  contaId: uuid().notNull().references(() => finContas.id),
  extratoId: uuid().references(() => finExtratos.id),
  idUnico: text().notNull(),
  data: date().notNull(),
  valorCentavos: centavos().notNull(),
  descricao: text().notNull().default(""),
  documento: text(),
  /** PENDENTE, CONCILIADO, TRANSFERENCIA ou IGNORADO. */
  status: text().notNull().default("PENDENTE"),
  lancamentoId: uuid().references(() => finLancamentos.id),
  parLinhaId: uuid(),
  /** Verdadeiro quando foi esta conciliação que baixou o lançamento (só então desfazer reabre a baixa). */
  baixaDaConciliacao: boolean().notNull().default(false),
  manual: boolean().notNull().default(false),
  observacao: text(),
  decididoPor: uuid().references(() => usuarios.id),
  decididoEm: timestamp({ withTimezone: true }),
  /** Importação da planilha que criou a linha (transferências entre contas), para "Desfazer importação". */
  importacaoId: uuid().references(() => finImportacoes.id, { onDelete: "set null" }),
  criadoEm: agora(),
}, (t) => [
  uniqueIndex("fin_linhas_conta_id_uq").on(t.contaId, t.idUnico),
  uniqueIndex("fin_linhas_lancamento_uq").on(t.lancamentoId).where(sql`lancamento_id is not null`),
  index("fin_linhas_conta_data_idx").on(t.contaId, t.data),
  index("fin_linhas_status_idx").on(t.status),
]);

/** Sugestões recusadas: a mesma linha nunca volta a sugerir o mesmo lançamento. */
export const finRecusas = pgTable("fin_recusas", {
  linhaId: uuid().notNull().references(() => finExtratoLinhas.id, { onDelete: "cascade" }),
  lancamentoId: uuid().notNull().references(() => finLancamentos.id, { onDelete: "cascade" }),
  recusadoPor: uuid().references(() => usuarios.id),
  criadoEm: agora(),
}, (t) => [uniqueIndex("fin_recusas_uq").on(t.linhaId, t.lancamentoId)]);

/** Regras de categorização por texto: só SUGEREM categoria (e praça/linha) para linhas de extrato. */
export const finRegras = pgTable("fin_regras", {
  id: uuid().primaryKey().defaultRandom(),
  texto: text().notNull(),
  /** RECEITA, DESPESA ou nulo (vale para os dois sentidos). */
  tipo: text(),
  categoriaId: uuid().notNull().references(() => finCategorias.id),
  unidadeId: uuid().references(() => unidades.id),
  linha: text(),
  prioridade: integer().notNull().default(0),
  ativa: boolean().notNull().default(true),
  criadoEm: agora(),
});

/** Fechamento diário do caixa em dinheiro (quiosque): saldo inicial, entradas, saídas, saldo contado e diferença. Um por conta e dia. */
export const finFechamentosCaixa = pgTable("fin_fechamentos_caixa", {
  id: uuid().primaryKey().defaultRandom(),
  contaId: uuid().notNull().references(() => finContas.id),
  data: date().notNull(),
  saldoInicialCentavos: centavos().notNull(),
  entradasCentavos: centavos().notNull(),
  saidasCentavos: centavos().notNull(),
  saldoCalculadoCentavos: centavos().notNull(),
  saldoContadoCentavos: centavos().notNull(),
  diferencaCentavos: centavos().notNull(),
  observacao: text(),
  fechadoPor: uuid().references(() => usuarios.id),
  fechadoEm: agora(),
}, (t) => [uniqueIndex("fin_fechamentos_caixa_uq").on(t.contaId, t.data)]);

/**
 * Revenda de serviços de terceiros (ex.: ingressos): venda (valor recebido do cliente), repasse ao fornecedor e comissão do vendedor,
 * cada um como lançamento. Na DRE só a margem (venda − repasse) entra como receita própria (tratamento contábil a confirmar).
 */
export const finRevendas = pgTable("fin_revendas", {
  id: uuid().primaryKey().defaultRandom(),
  descricao: text().notNull(),
  fornecedor: text(),
  unidadeId: uuid().references(() => unidades.id),
  dataVenda: date().notNull(),
  valorVendaCentavos: centavos().notNull(),
  valorRepasseCentavos: centavos().notNull(),
  comissaoCentavos: centavos().notNull().default(0),
  vendedor: text(),
  vendaLancamentoId: uuid().references(() => finLancamentos.id),
  repasseLancamentoId: uuid().references(() => finLancamentos.id),
  comissaoLancamentoId: uuid().references(() => finLancamentos.id),
  criadoPor: uuid().references(() => usuarios.id),
  criadoEm: agora(),
}, (t) => [index("fin_revendas_data_idx").on(t.dataVenda)]);

/**
 * Pendências de categoria da planilha (pedido do dono, 09/11/2026): linhas marcadas "não importar ainda" ficam guardadas para
 * classificar depois, sem importar de novo. Guarda a aba (CSV) CIFRADA só enquanto houver pendência; resolvido tudo, o conteúdo é apagado.
 */
export const finPlanilhaPendencias = pgTable("fin_planilha_pendencias", {
  id: uuid().primaryKey().defaultRandom(),
  unidadeId: uuid().references(() => unidades.id),
  arquivo: text(),
  /** Hash da aba + praça: importar a mesma aba de novo atualiza o mesmo registro. */
  hash: text().notNull(),
  conteudoCifrado: text(),
  pendentes: jsonb().$type<Array<{ chave: string; grupo: string; categoria: string; qtd: number; totalCentavos: number }>>().notNull().default(sql`'[]'::jsonb`),
  criadoPor: uuid().references(() => usuarios.id),
  criadoEm: agora(),
  atualizadoEm: agora(),
  resolvidoEm: timestamp({ withTimezone: true }),
}, (t) => [uniqueIndex("fin_planilha_pendencias_hash_uq").on(t.hash)]);
