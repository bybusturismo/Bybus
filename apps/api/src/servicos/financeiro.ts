import { PLANO_CATEGORIAS } from "@bybus/core";
import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../db/cliente.js";
import { finCategorias, finContas, finExtratoLinhas, finLancamentos, unidades } from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, type UsuarioSessao } from "../seguranca/sessao.js";

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

/** Cria o plano inicial de categorias (idempotente). */
export async function garantirPlano(db: Db): Promise<void> {
  await db.insert(finCategorias).values(PLANO_CATEGORIAS.map((c, i) => ({ codigo: c.codigo, nome: c.nome, tipo: c.tipo, grupo: c.grupo, ordem: (i + 1) * 10, sistema: true }))).onConflictDoNothing({ target: finCategorias.codigo });
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
 * + lançamentos realizados na conta que NÃO estão ligados a uma linha de extrato (ex.: caixa do quiosque).
 * Se a conta tem data do saldo inicial, só entra o que for posterior a ela.
 */
export async function saldosDasContas(db: Db, contas: Conta[]): Promise<Map<string, number>> {
  const saldos = new Map<string, number>(contas.map((c) => [c.id, c.saldoInicialCentavos]));
  if (contas.length === 0) return saldos;
  const ids = contas.map((c) => c.id);
  const linhas = await db.select({ contaId: finExtratoLinhas.contaId, total: sql<number>`coalesce(sum(${finExtratoLinhas.valorCentavos}), 0)`.mapWith(Number) })
    .from(finExtratoLinhas).innerJoin(finContas, eq(finContas.id, finExtratoLinhas.contaId))
    .where(and(inArray(finExtratoLinhas.contaId, ids), sql`(${finContas.saldoInicialEm} is null or ${finExtratoLinhas.data} > ${finContas.saldoInicialEm})`))
    .groupBy(finExtratoLinhas.contaId);
  for (const l of linhas) saldos.set(l.contaId, (saldos.get(l.contaId) ?? 0) + l.total);
  const avulsos = await db.select({
    contaId: finLancamentos.contaId,
    total: sql<number>`coalesce(sum(case when ${finLancamentos.tipo} = 'RECEBER' then ${finLancamentos.valorPagoCentavos} else -${finLancamentos.valorPagoCentavos} end), 0)`.mapWith(Number),
  }).from(finLancamentos).innerJoin(finContas, eq(finContas.id, finLancamentos.contaId))
    .where(and(
      inArray(finLancamentos.contaId, ids), eq(finLancamentos.situacao, "REALIZADO"), isNotNull(finLancamentos.valorPagoCentavos),
      sql`not exists (select 1 from fin_extrato_linhas l where l.lancamento_id = ${finLancamentos.id})`,
      sql`(${finContas.saldoInicialEm} is null or ${finLancamentos.pagoEm} > ${finContas.saldoInicialEm})`,
    ))
    .groupBy(finLancamentos.contaId);
  for (const a of avulsos) if (a.contaId) saldos.set(a.contaId, (saldos.get(a.contaId) ?? 0) + a.total);
  return saldos;
}

