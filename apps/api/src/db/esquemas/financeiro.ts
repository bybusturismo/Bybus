import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  /** MANUAL (digitado) ou EXTRATO (criado a partir de uma linha de extrato/fatura). */
  origem: text().notNull().default("MANUAL"),
  criadoPor: uuid().references(() => usuarios.id),
  criadoEm: agora(),
  atualizadoEm: agora(),
}, (t) => [
  index("fin_lanc_tipo_situacao_venc_idx").on(t.tipo, t.situacao, t.vencimento),
  index("fin_lanc_unidade_idx").on(t.unidadeId),
  index("fin_lanc_grupo_idx").on(t.grupoId),
  index("fin_lanc_competencia_idx").on(t.competencia),
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
  manual: boolean().notNull().default(false),
  observacao: text(),
  decididoPor: uuid().references(() => usuarios.id),
  decididoEm: timestamp({ withTimezone: true }),
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
