import { and, asc, eq, gte, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import {
  calcularNps, mediaNotas, periodoDoRelatorio, resumoNumeros, variacaoPercentual, type DadosRelatorio, type PeriodoRelatorio, type TipoRelatorio,
} from "@bybus/core";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import {
  avaliacaoExternas, avaliacaoNotas, avaliacaoPedidos, bioCliques, campanhas, npsRespostas, orcamentosGrupo, passageiros, passeios, relatoriosMarketing, reservas, saidas, unidades,
} from "../db/schema.js";
import { atribuicaoDeVendas, custosDasCampanhas } from "./atribuicao.js";
import { ErroIA, iaConfigurada, obterClienteIA } from "./ia/cliente.js";
import { garantirOrcamento, registrarUso, textoDe } from "./ia/orcamento.js";
import { somarDias } from "./marketingComum.js";

const canalExpr = sql<string>`coalesce(${reservas.canalOrigem}, ${reservas.canal})::text`;
const reservasN = sql<number>`count(distinct ${reservas.id})::int`;
const passageirosN = sql<number>`count(${passageiros.id})::int`;
const receitaN = sql<number | null>`sum(${reservas.valorCentavos})::int`;
const FEITOS = ["ENVIADA_MANUAL", "SIMULADA", "ENVIADA", "LEMBRADA", "AVALIADA"];

async function vendasDoPeriodo(db: Db, de: string, ate: string, unidadeId: string | null) {
  const onde = and(eq(reservas.status, "CONFIRMADA"), gte(saidas.data, de), lte(saidas.data, ate), unidadeId ? eq(passeios.unidadeId, unidadeId) : undefined);
  const origemExpr = sql<string>`upper(trim(coalesce(${reservas.origemCliente}, '')))`;
  const [total] = await db.select({ reservas: reservasN, passageiros: passageirosN, receita: receitaN }).from(reservas)
    .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).leftJoin(passageiros, eq(passageiros.reservaId, reservas.id)).where(onde);
  const porCanal = await db.select({ canal: canalExpr, reservas: reservasN, passageiros: passageirosN, receita: receitaN }).from(reservas)
    .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).leftJoin(passageiros, eq(passageiros.reservaId, reservas.id)).where(onde).groupBy(canalExpr).orderBy(sql`count(distinct ${reservas.id}) desc`);
  const origem = await db.select({ origem: origemExpr, passageiros: passageirosN }).from(reservas)
    .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).leftJoin(passageiros, eq(passageiros.reservaId, reservas.id)).where(onde).groupBy(origemExpr).orderBy(sql`count(${passageiros.id}) desc`).limit(8);
  return { total: { reservas: total?.reservas ?? 0, passageiros: total?.passageiros ?? 0, receitaCentavos: total?.receita ?? null }, porCanal, origem: origem.filter((o) => o.origem !== "").slice(0, 5) };
}

async function avaliacoesDoPeriodo(db: Db, de: string, ate: string, unidadeId: string | null) {
  const escopo = and(gte(saidas.data, de), lte(saidas.data, ate), unidadeId ? eq(passeios.unidadeId, unidadeId) : undefined);
  const pedidos = await db.select({ status: avaliacaoPedidos.status, n: sql<number>`count(*)::int` }).from(avaliacaoPedidos).innerJoin(saidas, eq(saidas.id, avaliacaoPedidos.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(escopo).groupBy(avaliacaoPedidos.status);
  const notas = await db.select({ nota: avaliacaoNotas.nota }).from(avaliacaoNotas).innerJoin(saidas, eq(saidas.id, avaliacaoNotas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(escopo);
  return {
    feitos: pedidos.filter((p) => FEITOS.includes(p.status)).reduce((s, p) => s + p.n, 0),
    avaliados: pedidos.find((p) => p.status === "AVALIADA")?.n ?? 0,
    nota: mediaNotas(notas.map((n) => n.nota)),
  };
}

async function npsDoPeriodo(db: Db, de: string, ate: string, unidadeId: string | null) {
  const r = await db.select({ nota: npsRespostas.nota }).from(npsRespostas).innerJoin(saidas, eq(saidas.id, npsRespostas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(and(gte(saidas.data, de), lte(saidas.data, ate), sql`${npsRespostas.nota} is not null`, unidadeId ? eq(passeios.unidadeId, unidadeId) : undefined));
  return calcularNps(r.map((x) => x.nota!));
}

const instante = (dia: string) => new Date(`${dia}T03:00:00Z`);

export async function montarDadosRelatorio(db: Db, per: PeriodoRelatorio, unidadeId: string | null): Promise<DadosRelatorio> {
  const [atual, anterior] = await Promise.all([vendasDoPeriodo(db, per.de, per.ate, unidadeId), vendasDoPeriodo(db, per.anteriorDe, per.anteriorAte, unidadeId)]);
  const ant = new Map(anterior.porCanal.map((c) => [c.canal, c.reservas]));

  // Campanhas: pedido atribuído por UTM/cupom, comprado no período.
  const lista = await db.select().from(campanhas).where(unidadeId ? sql`(${campanhas.unidadeId} is null or ${campanhas.unidadeId} = ${unidadeId})` : undefined);
  const auto = await atribuicaoDeVendas(db, null, lista, { de: per.de, ate: per.ate, unidadeId });
  const custos = await custosDasCampanhas(db, lista.map((c) => c.id), { de: per.de, ate: per.ate });
  const camp = lista.filter((c) => (auto.porCampanha.get(c.id)?.reservas ?? 0) > 0).map((c) => {
    const t = auto.porCampanha.get(c.id)!;
    const custo = custos.get(c.id);
    const invest = custo ? custo.custoCentavos : c.investimentoCentavos;
    return {
      nome: c.nome, midia: c.midia, reservas: t.reservas, receitaCentavos: t.receitaCentavos, investimentoCentavos: invest, custoOrigem: custo ? "CSV" as const : "TOTAL_DA_CAMPANHA" as const,
      custoPorReservaCentavos: invest > 0 ? Math.round(invest / t.reservas) : null, retorno: t.receitaCentavos != null && invest > 0 ? Math.round((t.receitaCentavos / invest) * 100) / 100 : null,
    };
  }).sort((a, b) => b.reservas - a.reservas);

  const [av, avAnt, nps, npsAnt] = await Promise.all([avaliacoesDoPeriodo(db, per.de, per.ate, unidadeId), avaliacoesDoPeriodo(db, per.anteriorDe, per.anteriorAte, unidadeId), npsDoPeriodo(db, per.de, per.ate, unidadeId), npsDoPeriodo(db, per.anteriorDe, per.anteriorAte, unidadeId)]);
  // Notas lançadas à mão: a mais recente de cada canal (da própria empresa) até o fim do período.
  const ext = await db.select().from(avaliacaoExternas).where(and(lte(avaliacaoExternas.semana, per.ate), eq(avaliacaoExternas.alvo, "PROPRIA"), unidadeId ? sql`(${avaliacaoExternas.unidadeId} = ${unidadeId} or ${avaliacaoExternas.unidadeId} is null)` : undefined)).orderBy(asc(avaliacaoExternas.semana));
  const ultimas = new Map<string, (typeof ext)[number]>();
  for (const e of ext) ultimas.set(e.canal, e);

  let orcamentos: DadosRelatorio["orcamentos"] = null;
  let bio: DadosRelatorio["bio"] = null;
  if (!unidadeId) {
    const contar = async (de: string, ate: string, extra?: SQL) => (await db.select({ n: sql<number>`count(*)::int` }).from(orcamentosGrupo).where(and(gte(orcamentosGrupo.criadoEm, instante(de)), lt(orcamentosGrupo.criadoEm, instante(somarDias(ate, 1))), extra)))[0]?.n ?? 0;
    orcamentos = { recebidos: await contar(per.de, per.ate), recebidosAnterior: await contar(per.anteriorDe, per.anteriorAte), fechados: await contar(per.de, per.ate, eq(orcamentosGrupo.status, "FECHADO")) };
    const somaBio = async (de: string, ate: string, visita: boolean) => (await db.select({ n: sql<number>`coalesce(sum(${bioCliques.contagem}), 0)::int` }).from(bioCliques)
      .where(and(gte(bioCliques.dia, de), lte(bioCliques.dia, ate), visita ? eq(bioCliques.chave, "visita") : sql`${bioCliques.chave} <> 'visita'`)))[0]?.n ?? 0;
    bio = { visitas: await somaBio(per.de, per.ate, true), cliques: await somaBio(per.de, per.ate, false), visitasAnterior: await somaBio(per.anteriorDe, per.anteriorAte, true), cliquesAnterior: await somaBio(per.anteriorDe, per.anteriorAte, false) };
  }

  return {
    periodo: per,
    vendas: {
      atual: atual.total, anterior: anterior.total,
      variacao: { reservas: variacaoPercentual(atual.total.reservas, anterior.total.reservas), passageiros: variacaoPercentual(atual.total.passageiros, anterior.total.passageiros), receita: atual.total.receitaCentavos != null && anterior.total.receitaCentavos != null ? variacaoPercentual(atual.total.receitaCentavos, anterior.total.receitaCentavos) : null },
      porCanal: atual.porCanal.map((c) => ({ canal: c.canal, reservas: c.reservas, passageiros: c.passageiros, receitaCentavos: c.receita, reservasAnterior: ant.get(c.canal) ?? 0, variacaoReservas: variacaoPercentual(c.reservas, ant.get(c.canal) ?? 0) })),
    },
    origem: atual.origem.map((o) => ({ origem: o.origem, passageiros: o.passageiros })),
    campanhas: camp,
    avaliacoes: {
      pedidosFeitos: av.feitos, avaliados: av.avaliados, pedidosFeitosAnterior: avAnt.feitos, avaliadosAnterior: avAnt.avaliados, notaInterna: av.nota, notaInternaAnterior: avAnt.nota,
      notasCanais: [...ultimas.values()].map((e) => ({ canal: e.canal, nota: e.notaCentesimos / 100, quantidade: e.quantidade })),
    },
    nps: { respostas: nps.total, nps: nps.nps, npsAnterior: npsAnt.nps, detratores: nps.detratores },
    orcamentos, bio,
  };
}

const SISTEMA_RESUMO = `Você escreve o resumo de um relatório de marketing da By Bus Turismo (passeios de ônibus em Florianópolis e Balneário Camboriú).
Receberá só números agregados em JSON. Escreva em português do Brasil, em no máximo 8 linhas curtas, tom direto e prático:
1) o que mudou em relação ao período anterior (reservas, canais, campanhas, avaliações, NPS);
2) o que merece atenção;
3) uma ação sugerida.
Use apenas os números recebidos, sem inventar causas, valores ou nomes. Valores em centavos (BRL): converta para reais. Não peça dados pessoais.`;

/** Resumo escrito pela IA (só com a IA ligada; erro da IA nunca derruba o relatório). Recebe apenas os agregados do relatório. */
export async function resumoDaIa(db: Db, config: Config, dados: DadosRelatorio): Promise<string | null> {
  if (!iaConfigurada(config)) return null;
  try {
    await garantirOrcamento(db, config);
    const r = await obterClienteIA(config).enviar({ modelo: config.IA_MODELO, esforco: "low", sistema: SISTEMA_RESUMO, ferramentas: [], mensagens: [{ role: "user", content: JSON.stringify(dados) }], maxTokens: 1500 });
    await registrarUso(db, config.IA_MODELO, r, { tipo: "RELATORIO" });
    return textoDe(r.content).slice(0, 4000) || null;
  } catch (e) {
    if (!(e instanceof ErroIA)) console.error("Falha no resumo do relatório de marketing:", e instanceof Error ? e.message : e);
    return null;
  }
}

export interface OpcoesGeracao { geradoPor?: string | null; regenerar?: boolean; usarIa?: boolean }

/** Gera o relatório do período para o consolidado e para cada praça ativa. Já existente: só refaz com `regenerar`. Devolve os ids criados/atualizados. */
export async function gerarRelatorios(db: Db, config: Config, tipo: TipoRelatorio, referencia: string, o: OpcoesGeracao = {}): Promise<string[]> {
  const per = periodoDoRelatorio(tipo, referencia);
  const pracas = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.ativa, true));
  const ids: string[] = [];
  for (const unidadeId of [null, ...pracas.map((p) => p.id)]) {
    const [existente] = await db.select({ id: relatoriosMarketing.id }).from(relatoriosMarketing)
      .where(and(eq(relatoriosMarketing.tipo, tipo), eq(relatoriosMarketing.de, per.de), eq(relatoriosMarketing.ate, per.ate), unidadeId ? eq(relatoriosMarketing.unidadeId, unidadeId) : isNull(relatoriosMarketing.unidadeId)));
    if (existente && !o.regenerar) continue;
    const dados = await montarDadosRelatorio(db, per, unidadeId);
    const valores = { dados, resumoNumeros: resumoNumeros(dados), resumoIa: o.usarIa === false ? null : await resumoDaIa(db, config, dados), geradoPor: o.geradoPor ?? null, geradoEm: new Date() };
    if (existente) {
      await db.update(relatoriosMarketing).set(valores).where(eq(relatoriosMarketing.id, existente.id));
      ids.push(existente.id);
    } else {
      const [novo] = await db.insert(relatoriosMarketing).values({ tipo, de: per.de, ate: per.ate, unidadeId, ...valores }).returning({ id: relatoriosMarketing.id });
      ids.push(novo!.id);
    }
  }
  return ids;
}
