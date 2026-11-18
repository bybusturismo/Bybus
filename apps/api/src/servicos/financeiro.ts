import { PLANO_CATEGORIAS, SINONIMOS_PADRAO, type TipoCategoria } from "@bybus/core";
import { and, eq, inArray, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../db/cliente.js";
import { finCategorias, finContas, finExtratoLinhas, finFechamentosCaixa, finLancamentos, finRegras, finSinonimos, unidades } from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, type UsuarioSessao } from "../seguranca/sessao.js";

/** Lançamento conciliado = existe linha de extrato apontando para ele (uma só definição, usada em consultas e travas). */
export const conciliadoSql = sql<boolean>`exists (select 1 from fin_extrato_linhas l where l.lancamento_id = ${finLancamentos.id})`;
export const naoConciliadoSql = sql`not exists (select 1 from fin_extrato_linhas l where l.lancamento_id = ${finLancamentos.id})`;

export type Conta = typeof finContas.$inferSelect;
export type Lancamento = typeof finLancamentos.$inferSelect;
export type LinhaExtrato = typeof finExtratoLinhas.$inferSelect;

/** Hoje (dia civil) em America/Sao_Paulo. */
export function hojeSP(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** Escopo por praça: quem não vê todas as praças só enxerga registros das suas (registros "da empresa toda", sem praça, ficam ocultos). */
export function filtroPraca(u: UsuarioSessao, coluna: PgColumn): SQL | undefined {
  if (u.todasUnidades) return undefined;
  if (u.unidadeIds.length === 0) return sql`false`;
  return inArray(coluna, u.unidadeIds);
}

/** Caixa em dinheiro com o dia fechado não aceita baixas nem reaberturas naquela data. */
export async function garantirCaixaAberto(db: Db, contaId: string | null, data: string | null): Promise<void> {
  if (!contaId || !data) return;
  const [f] = await db.select({ id: finFechamentosCaixa.id }).from(finFechamentosCaixa).where(and(eq(finFechamentosCaixa.contaId, contaId), eq(finFechamentosCaixa.data, data)));
  if (f) throw new ErroHttp(409, "CAIXA_FECHADO", "O caixa deste dia já foi fechado. Não é possível lançar nem alterar movimentos nessa data.");
}

/** Praça escolhida num filtro: precisa estar no escopo do usuário. */
export function filtroPracaEscolhida(u: UsuarioSessao, coluna: PgColumn, unidadeId: string | undefined): SQL | undefined {
  if (!unidadeId) return filtroPraca(u, coluna);
  if (!podeUnidade(u, unidadeId)) return sql`false`;
  return eq(coluna, unidadeId);
}

const naoEncontrado = (o: string) => new ErroHttp(404, "NAO_ENCONTRADO", `${o} não encontrado(a).`);

/** Praça de um novo registro: obrigatória para quem não vê todas as praças; precisa estar no escopo e ativa. */
export async function validarPracaDoRegistro(db: Db, u: UsuarioSessao, unidadeId: string | null | undefined): Promise<string | null> {
  if (!unidadeId) {
    if (!u.todasUnidades) throw new ErroHttp(400, "PRACA_OBRIGATORIA", "Informe a praça.");
    return null;
  }
  if (!podeUnidade(u, unidadeId)) throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não atua nesta praça.");
  const [x] = await db.select({ ativa: unidades.ativa }).from(unidades).where(eq(unidades.id, unidadeId));
  if (!x) throw new ErroHttp(400, "PRACA_INVALIDA", "Praça inexistente.");
  if (!x.ativa) throw new ErroHttp(400, "PRACA_INATIVA", "Esta praça está desativada.");
  return unidadeId;
}

export async function garantirConta(db: Db, u: UsuarioSessao, id: string): Promise<Conta> {
  const [c] = await db.select().from(finContas).where(eq(finContas.id, id));
  if (!c || !(u.todasUnidades || (c.unidadeId && podeUnidade(u, c.unidadeId)))) throw naoEncontrado("Conta");
  return c;
}

export async function garantirLancamento(db: Db, u: UsuarioSessao, id: string): Promise<Lancamento> {
  const [l] = await db.select().from(finLancamentos).where(eq(finLancamentos.id, id));
  if (!l || !(u.todasUnidades || (l.unidadeId && podeUnidade(u, l.unidadeId)))) throw naoEncontrado("Lançamento");
  return l;
}

export async function garantirLinha(db: Db, u: UsuarioSessao, id: string): Promise<{ linha: LinhaExtrato; conta: Conta }> {
  const [l] = await db.select().from(finExtratoLinhas).where(eq(finExtratoLinhas.id, id));
  if (!l) throw naoEncontrado("Linha do extrato");
  const conta = await garantirConta(db, u, l.contaId).catch(() => { throw naoEncontrado("Linha do extrato"); });
  return { linha: l, conta };
}

/** Lançamento conciliado = existe linha de extrato apontando para ele. */
export async function estaConciliado(db: Db, lancamentoId: string): Promise<boolean> {
  const [r] = await db.select({ id: finExtratoLinhas.id }).from(finExtratoLinhas).where(eq(finExtratoLinhas.lancamentoId, lancamentoId)).limit(1);
  return !!r;
}

/**
 * Cria o plano padrão de categorias e atualiza nome, grupo e ordem das categorias do sistema (idempotente).
 * Categorias criadas pelo usuário não são tocadas.
 */
export async function garantirPlano(db: Db): Promise<void> {
  await db.insert(finCategorias).values(PLANO_CATEGORIAS.map((c, i) => ({ codigo: c.codigo, nome: c.nome, tipo: c.tipo, grupo: c.grupo, ordem: (i + 1) * 10, sistema: true })))
    .onConflictDoUpdate({ target: finCategorias.codigo, set: { nome: sql`excluded.nome`, grupo: sql`excluded.grupo`, ordem: sql`excluded.ordem` }, setWhere: sql`${finCategorias.sistema} = true` });
}

/** Semeia o dicionário de sinônimos só quando está vazio (assim o que a pessoa editar ou apagar não volta). */
export async function garantirSinonimos(db: Db): Promise<void> {
  const [existe] = await db.select({ id: finSinonimos.id }).from(finSinonimos).limit(1);
  if (existe) return;
  await db.insert(finSinonimos).values(SINONIMOS_PADRAO.map((s) => ({ tipo: s.tipo, texto: s.texto, alvo: s.alvo }))).onConflictDoNothing();
}

export async function validarCategoria(db: Db, categoriaId: string, tipo: "PAGAR" | "RECEBER") {
  const [c] = await db.select().from(finCategorias).where(eq(finCategorias.id, categoriaId));
  if (!c) throw new ErroHttp(400, "CATEGORIA_INVALIDA", "Categoria inexistente.");
  if (!c.ativa) throw new ErroHttp(400, "CATEGORIA_INATIVA", "Esta categoria está desativada.");
  if ((tipo === "PAGAR") !== (c.tipo === "DESPESA")) {
    throw new ErroHttp(400, "CATEGORIA_INCOMPATIVEL", tipo === "PAGAR" ? "Conta a pagar exige categoria de despesa." : "Conta a receber exige categoria de receita.");
  }
  return c;
}

/**
 * Saldo de cada conta = saldo inicial + movimento do extrato (todas as linhas, com sinal)
 * + lançamentos realizados na conta que NÃO estão ligados a uma linha e NÃO caem no período de um extrato importado
 * (ex.: caixa do quiosque, que não tem extrato). Assim, uma baixa manual e a linha do mesmo movimento não contam em dobro,
 * nem antes de conciliar.
 * "Saldo válido em" (saldoInicialEm) é o saldo no INÍCIO daquele dia: movimentos da própria data entram (>=).
 * `antesDe` calcula o saldo no início de outra data (só movimentos anteriores a ela).
 */
export async function saldosDasContas(db: Db, contas: Conta[], antesDe?: string): Promise<Map<string, number>> {
  const saldos = new Map<string, number>(contas.map((c) => [c.id, c.saldoInicialCentavos]));
  if (contas.length === 0) return saldos;
  const ids = contas.map((c) => c.id);
  const linhas = await db.select({ contaId: finExtratoLinhas.contaId, total: sql<number>`coalesce(sum(${finExtratoLinhas.valorCentavos}), 0)`.mapWith(Number) })
    .from(finExtratoLinhas).innerJoin(finContas, eq(finContas.id, finExtratoLinhas.contaId))
    .where(and(inArray(finExtratoLinhas.contaId, ids), ne(finExtratoLinhas.status, "REPETIDA"), sql`(${finContas.saldoInicialEm} is null or ${finExtratoLinhas.data} >= ${finContas.saldoInicialEm})`, antesDe ? sql`${finExtratoLinhas.data} < ${antesDe}` : undefined))
    .groupBy(finExtratoLinhas.contaId);
  for (const l of linhas) saldos.set(l.contaId, (saldos.get(l.contaId) ?? 0) + l.total);
  const avulsos = await db.select({
    contaId: finLancamentos.contaId,
    total: sql<number>`coalesce(sum(case when ${finLancamentos.tipo} = 'RECEBER' then ${finLancamentos.valorPagoCentavos} else -${finLancamentos.valorPagoCentavos} end), 0)`.mapWith(Number),
  }).from(finLancamentos).innerJoin(finContas, eq(finContas.id, finLancamentos.contaId))
    .where(and(
      inArray(finLancamentos.contaId, ids), eq(finLancamentos.situacao, "REALIZADO"), isNotNull(finLancamentos.valorPagoCentavos),
      naoConciliadoSql,
      sql`not exists (select 1 from fin_extratos e where e.conta_id = ${finLancamentos.contaId} and e.inicio <= ${finLancamentos.pagoEm} and e.fim >= ${finLancamentos.pagoEm})`,
      sql`(${finContas.saldoInicialEm} is null or ${finLancamentos.pagoEm} >= ${finContas.saldoInicialEm})`,
      antesDe ? sql`${finLancamentos.pagoEm} < ${antesDe}` : undefined,
    ))
    .groupBy(finLancamentos.contaId);
  for (const a of avulsos) if (a.contaId) saldos.set(a.contaId, (saldos.get(a.contaId) ?? 0) + a.total);
  return saldos;
}

export type EntradaRegra = { tipo?: TipoCategoria | null; categoriaId: string; unidadeId?: string | null };

/** Valida uma regra (criação ou edição): categoria existente, tipo compatível com a categoria e praça no escopo. */
export async function validarRegra(db: Db, u: UsuarioSessao, r: EntradaRegra) {
  const [cat] = await db.select().from(finCategorias).where(eq(finCategorias.id, r.categoriaId));
  if (!cat) throw new ErroHttp(400, "CATEGORIA_INVALIDA", "Categoria inexistente.");
  if (r.tipo && r.tipo !== cat.tipo) throw new ErroHttp(400, "TIPO_INCOMPATIVEL", "O tipo da regra não combina com o tipo da categoria.");
  if (r.unidadeId) await validarPracaDoRegistro(db, u, r.unidadeId);
  else if (!u.todasUnidades) throw new ErroHttp(403, "SEM_PERMISSAO", "Regras para todas as praças só podem ser criadas por quem vê todas as praças.");
  return cat;
}

/** Regra existente dentro do escopo do usuário (regra geral, sem praça, só para quem vê todas as praças). */
export async function garantirRegra(db: Db, u: UsuarioSessao, id: string) {
  const [r] = await db.select().from(finRegras).where(eq(finRegras.id, id));
  if (!r || !(u.todasUnidades || (r.unidadeId && podeUnidade(u, r.unidadeId)))) throw naoEncontrado("Regra");
  return r;
}

/**
 * Há outra linha DO BANCO (não criada no sistema) da mesma conta, com o mesmo valor, em até 5 dias, que ainda conta no saldo?
 * Então esta pode ser a repetida. Transferência lançada pela planilha ou à mão não conta como gêmea: nesse caso é ela que se desfaz.
 */
export function linhaTemGemea(l: { id: string; contaId: string; data: string; valorCentavos: number }, outras: ReadonlyArray<{ id: string; contaId: string; data: string; valorCentavos: number; status: string; manual: boolean }>) {
  const dia = (d: string) => Date.parse(`${d}T12:00:00Z`) / 86_400_000;
  return outras.some((o) => o.id !== l.id && o.contaId === l.contaId && o.valorCentavos === l.valorCentavos && !o.manual && o.status !== "REPETIDA" && Math.abs(dia(o.data) - dia(l.data)) <= 5);
}

/**
 * Série (parcelas ou recorrência) lançada com "Definir na baixa": quando um mês é baixado ou conciliado numa conta,
 * os outros meses da série que continuam em aberto e sem conta passam a usar a mesma conta (dono, 18/11/2026: as contas
 * recorrentes do Sicredi "sumiam" do filtro por conta porque só o mês pago recebia a conta). Não mexe em mês que já tem conta.
 * Devolve quantos lançamentos receberam a conta.
 */
export async function preencherContaDaSerie(db: Pick<Db, "update">, lanc: { id: string; grupoId: string | null }, contaId: string): Promise<number> {
  if (!lanc.grupoId) return 0;
  const r = await db.update(finLancamentos).set({ contaId, atualizadoEm: new Date() })
    .where(and(eq(finLancamentos.grupoId, lanc.grupoId), ne(finLancamentos.id, lanc.id), eq(finLancamentos.situacao, "ABERTO"), isNull(finLancamentos.contaId)))
    .returning({ id: finLancamentos.id });
  return r.length;
}
