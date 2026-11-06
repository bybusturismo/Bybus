import { and, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { atribuirVenda, type AfiliadoAtribuivel, type CampanhaAtribuivel } from "@bybus/core";
import type { Db } from "../db/cliente.js";
import { afiliados, campanhaCustos, passageiros, passeios, reservas, saidas, vendas } from "../db/schema.js";
import { filtroUnidade } from "../seguranca/escopo.js";
import type { UsuarioSessao } from "../seguranca/sessao.js";
import { somarDias } from "./marketingComum.js";

export interface Totais { vendas: number; reservas: number; passageiros: number; receitaCentavos: number | null; porUtm: number; porCupom: number }
const zero = (): Totais => ({ vendas: 0, reservas: 0, passageiros: 0, receitaCentavos: null, porUtm: 0, porCupom: 0 });

export interface ResultadoAtribuicao {
  porCampanha: Map<string, Totais>;
  porAfiliado: Map<string, Totais>;
  /** Pedidos do período com algum sinal (UTM, cupom ou afiliado) e quantos ficaram sem campanha nem afiliado. */
  comSinal: number;
  semAtribuicao: number;
}

/**
 * Atribuição automática: liga cada pedido da Paytour (utm_campaign, cupom_id, afiliado_id da tabela vendas) à campanha e ao afiliado
 * pelas regras do core. Conta só reservas confirmadas e, com `u`, só as praças do usuário. A receita é a soma do valor das reservas (centavos).
 * `de`/`ate` filtram o dia da compra (America/Sao_Paulo).
 */
export async function atribuicaoDeVendas(db: Db, u: UsuarioSessao | null, campanhas: CampanhaAtribuivel[], opcoes: { de?: string; ate?: string; unidadeId?: string | null } = {}): Promise<ResultadoAtribuicao> {
  const afs = await db.select({ id: afiliados.id, codigo: afiliados.codigo, paytourAfiliadoId: afiliados.paytourAfiliadoId }).from(afiliados) as AfiliadoAtribuivel[];
  const porCampanha = new Map<string, Totais>();
  const porAfiliado = new Map<string, Totais>();
  if (campanhas.length === 0 && afs.length === 0) return { porCampanha, porAfiliado, comSinal: 0, semAtribuicao: 0 };
  const inicioMin = campanhas.map((c) => c.inicio).sort()[0];
  const de = [opcoes.de, inicioMin].filter(Boolean).sort().pop();
  const compraEm = sql`(${vendas.dataHoraCompra} at time zone 'America/Sao_Paulo')::date`;
  const linhas = await db.select({
    vendaId: vendas.id, utm: vendas.utmCampaign, cupom: vendas.cupomExternoId, afiliado: vendas.afiliadoId,
    dia: sql<string | null>`to_char(${compraEm}, 'YYYY-MM-DD')`,
    reservaId: reservas.id, valor: reservas.valorCentavos,
    pax: sql<number>`(select count(*)::int from ${passageiros} where ${passageiros.reservaId} = ${reservas.id})`,
  }).from(vendas).innerJoin(reservas, eq(reservas.vendaId, vendas.id)).innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(and(
      eq(reservas.status, "CONFIRMADA"), u ? filtroUnidade(u) : undefined, opcoes.unidadeId ? eq(passeios.unidadeId, opcoes.unidadeId) : undefined,
      or(isNotNull(vendas.utmCampaign), isNotNull(vendas.cupomExternoId), isNotNull(vendas.afiliadoId)),
      de ? gte(vendas.dataHoraCompra, new Date(`${de}T03:00:00Z`)) : undefined,
      opcoes.ate ? lt(vendas.dataHoraCompra, new Date(`${somarDias(opcoes.ate, 1)}T03:00:00Z`)) : undefined,
    ));
  const porVenda = new Map<string, { dia: string | null; utm: string | null; cupom: string | null; afiliado: string | null; reservas: number; pax: number; receita: number | null }>();
  for (const l of linhas) {
    const v = porVenda.get(l.vendaId) ?? { dia: l.dia, utm: l.utm, cupom: l.cupom, afiliado: l.afiliado, reservas: 0, pax: 0, receita: null };
    v.reservas += 1;
    v.pax += l.pax;
    if (l.valor != null) v.receita = (v.receita ?? 0) + l.valor;
    porVenda.set(l.vendaId, v);
  }
  let semAtribuicao = 0;
  const somar = (m: Map<string, Totais>, id: string, v: { reservas: number; pax: number; receita: number | null }, regra?: "UTM" | "CUPOM" | null) => {
    const t = m.get(id) ?? zero();
    t.vendas += 1; t.reservas += v.reservas; t.passageiros += v.pax;
    if (v.receita != null) t.receitaCentavos = (t.receitaCentavos ?? 0) + v.receita;
    if (regra === "UTM") t.porUtm += 1;
    if (regra === "CUPOM") t.porCupom += 1;
    m.set(id, t);
  };
  for (const v of porVenda.values()) {
    const a = atribuirVenda({ utmCampaign: v.utm, cupomExternoId: v.cupom, afiliadoId: v.afiliado, dia: v.dia }, campanhas, afs);
    if (a.campanhaId) somar(porCampanha, a.campanhaId, v, a.regraCampanha);
    if (a.afiliadoId) somar(porAfiliado, a.afiliadoId, v);
    if (!a.campanhaId && !a.afiliadoId) semAtribuicao += 1;
  }
  return { porCampanha, porAfiliado, comSinal: porVenda.size, semAtribuicao };
}

export interface CustoCampanha { custoCentavos: number; cliques: number | null; impressoes: number | null; dias: number }

/** Custo importado por CSV (soma dos dias, dentro do período se houver). Campanha sem linhas não aparece no mapa. */
export async function custosDasCampanhas(db: Db, ids: string[], opcoes: { de?: string; ate?: string } = {}): Promise<Map<string, CustoCampanha>> {
  if (ids.length === 0) return new Map();
  const linhas = await db.select({
    campanhaId: campanhaCustos.campanhaId, custo: sql<number>`sum(${campanhaCustos.custoCentavos})::int`, cliques: sql<number | null>`sum(${campanhaCustos.cliques})::int`,
    impressoes: sql<number | null>`sum(${campanhaCustos.impressoes})::int`, dias: sql<number>`count(*)::int`,
  }).from(campanhaCustos).where(and(inArray(campanhaCustos.campanhaId, ids), opcoes.de ? gte(campanhaCustos.dia, opcoes.de) : undefined, opcoes.ate ? sql`${campanhaCustos.dia} <= ${opcoes.ate}` : undefined)).groupBy(campanhaCustos.campanhaId);
  return new Map(linhas.map((l) => [l.campanhaId, { custoCentavos: l.custo, cliques: l.cliques, impressoes: l.impressoes, dias: l.dias }]));
}
