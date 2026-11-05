import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "../db/cliente.js";
import { finExtratoLinhas, finLancamentos } from "../db/schema.js";
import { naoConciliadoSql, type Conta } from "./financeiro.js";

export interface MovimentoDia {
  entradasCentavos: number;
  saidasCentavos: number;
}

/**
 * Entradas e saídas por dia de uma conta, na mesma regra do saldo: linhas de extrato (inclusive transferências) mais
 * lançamentos baixados que não estão ligados a uma linha nem caem no período de um extrato importado.
 */
export async function movimentosPorDia(db: Db, conta: Conta, de: string, ate: string): Promise<Map<string, MovimentoDia>> {
  const inicio = conta.saldoInicialEm && conta.saldoInicialEm > de ? conta.saldoInicialEm : de;
  const mapa = new Map<string, MovimentoDia>();
  const soma = (data: string, v: number) => {
    const m = mapa.get(data) ?? { entradasCentavos: 0, saidasCentavos: 0 };
    if (v >= 0) m.entradasCentavos += v; else m.saidasCentavos += -v;
    mapa.set(data, m);
  };
  const linhas = await db.select({ data: finExtratoLinhas.data, valor: finExtratoLinhas.valorCentavos }).from(finExtratoLinhas)
    .where(and(eq(finExtratoLinhas.contaId, conta.id), gte(finExtratoLinhas.data, inicio), lte(finExtratoLinhas.data, ate)));
  for (const l of linhas) soma(l.data, l.valor);
  const avulsos = await db.select({ data: finLancamentos.pagoEm, tipo: finLancamentos.tipo, valor: finLancamentos.valorPagoCentavos }).from(finLancamentos)
    .where(and(
      eq(finLancamentos.contaId, conta.id), eq(finLancamentos.situacao, "REALIZADO"), isNotNull(finLancamentos.valorPagoCentavos), gte(finLancamentos.pagoEm, inicio), lte(finLancamentos.pagoEm, ate),
      naoConciliadoSql,
      sql`not exists (select 1 from fin_extratos e where e.conta_id = ${finLancamentos.contaId} and e.inicio <= ${finLancamentos.pagoEm} and e.fim >= ${finLancamentos.pagoEm})`,
    ));
  for (const a of avulsos) if (a.data && a.valor !== null) soma(a.data, a.tipo === "RECEBER" ? a.valor : -a.valor);
  return mapa;
}
