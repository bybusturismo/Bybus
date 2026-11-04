import { alertaConsumo, consumoPorAbastecimento, situacaoPlano } from "@bybus/core";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/cliente.js";
import { finExtratoLinhas, finLancamentos, veiculos, veiculosAbastecimentos, veiculosChecklists, veiculosDocumentos, veiculosOrdens, veiculosPlanos } from "../../db/schema.js";

/**
 * Retratos extras dos módulos de Frota e Financeiro. SÓ AGREGADOS: contagens e somas em centavos,
 * sem placa, descrição, fornecedor/cliente nem qualquer identificador (o filtro de LGPD ainda confere tudo).
 * As chaves evitam prefixos que a trava de LGPD trata como dado pessoal (ex.: "documento…").
 */

function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function retratoFrotaExtra(db: Db, hoje: string): Promise<Record<string, unknown>> {
  const lista = await db.select({ id: veiculos.id, situacao: veiculos.situacao, kmAtual: veiculos.kmAtual }).from(veiculos);
  const porSituacao: Record<string, number> = {};
  for (const v of lista) porSituacao[v.situacao] = (porSituacao[v.situacao] ?? 0) + 1;
  const emOperacao = new Set(lista.filter((v) => v.situacao !== "INATIVO").map((v) => v.id));
  const km = new Map(lista.map((v) => [v.id, v.kmAtual]));

  const docs = await db.select({ veiculoId: veiculosDocumentos.veiculoId, vencimento: veiculosDocumentos.vencimento }).from(veiculosDocumentos);
  const em30 = somarDias(hoje, 30);
  const docsAtivos = docs.filter((d) => emOperacao.has(d.veiculoId));
  const docsVencidos = docsAtivos.filter((d) => d.vencimento < hoje);

  const planos = await db.select().from(veiculosPlanos).where(eq(veiculosPlanos.ativo, true));
  const sit = planos.filter((p) => emOperacao.has(p.veiculoId)).map((p) => ({
    critico: p.critico, veiculoId: p.veiculoId,
    situacao: situacaoPlano({ intervaloKm: p.intervaloKm, intervaloDias: p.intervaloDias, ultimoKm: p.ultimoKm, ultimaData: p.ultimaData, kmAtual: km.get(p.veiculoId) ?? 0, hoje }).situacao,
  }));

  const ordens = await db.select({ imobiliza: veiculosOrdens.imobiliza, tipo: veiculosOrdens.tipo }).from(veiculosOrdens).where(eq(veiculosOrdens.status, "ABERTA"));
  const [reprovados] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(veiculosChecklists)
    .where(and(eq(veiculosChecklists.aprovado, false), sql`${veiculosChecklists.data} >= ${somarDias(hoje, -7)}::date`));

  // Consumo (km/l): compara cada abastecimento dos últimos 30 dias com a média anterior do mesmo veículo.
  const abast = await db.select({ id: veiculosAbastecimentos.id, veiculoId: veiculosAbastecimentos.veiculoId, km: veiculosAbastecimentos.km, litros: veiculosAbastecimentos.litros, tanqueCheio: veiculosAbastecimentos.tanqueCheio, data: veiculosAbastecimentos.data }).from(veiculosAbastecimentos);
  const alertas = { ALTO: 0, BAIXO: 0 };
  const dataPorId = new Map(abast.map((a) => [a.id, a.data]));
  for (const vid of new Set(abast.map((a) => a.veiculoId))) {
    const doVeiculo = abast.filter((a) => a.veiculoId === vid).sort((a, b) => a.km - b.km);
    const consumo = consumoPorAbastecimento(doVeiculo);
    doVeiculo.forEach((a, i) => {
      if ((dataPorId.get(a.id) ?? "") < somarDias(hoje, -30)) return;
      const r = alertaConsumo(consumo.get(a.id) ?? null, doVeiculo.slice(0, i).map((x) => consumo.get(x.id) ?? null));
      if (r) alertas[r] += 1;
    });
  }

  const retrato = {
    veiculosPorSituacao: porSituacao,
    motivosDeIndisponibilidade: {
      inativos: porSituacao.INATIVO ?? 0,
      emManutencao: porSituacao.MANUTENCAO ?? 0,
      comRegistroVencido: new Set(docsVencidos.map((d) => d.veiculoId)).size,
      comPlanoCriticoVencido: new Set(sit.filter((p) => p.critico && p.situacao === "VENCIDA").map((p) => p.veiculoId)).size,
      comOrdemImobilizandoAberta: ordens.filter((o) => o.imobiliza).length,
    },
    registrosDosVeiculos: { vencidos: docsVencidos.length, vencendoEm30Dias: docsAtivos.filter((d) => d.vencimento >= hoje && d.vencimento <= em30).length },
    planosDeManutencao: { vencidos: sit.filter((p) => p.situacao === "VENCIDA").length, proximos: sit.filter((p) => p.situacao === "PROXIMA").length, semBase: sit.filter((p) => p.situacao === "SEM_BASE").length },
    ordensAbertas: { total: ordens.length, corretivas: ordens.filter((o) => o.tipo === "CORRETIVA").length, imobilizando: ordens.filter((o) => o.imobiliza).length },
    checklistsReprovadosUltimos7Dias: reprovados?.n ?? 0,
    alertasDeConsumoUltimos30Dias: { gastoAlto: alertas.ALTO, possivelErroDeDigitacao: alertas.BAIXO },
    alertasDaFrota: [] as string[],
  };
  const a = retrato.alertasDaFrota;
  if (retrato.registrosDosVeiculos.vencidos) a.push(`${retrato.registrosDosVeiculos.vencidos} registro(s) de veículo vencido(s) (CRLV, seguro etc.)`);
  if (retrato.registrosDosVeiculos.vencendoEm30Dias) a.push(`${retrato.registrosDosVeiculos.vencendoEm30Dias} registro(s) de veículo vencendo em 30 dias`);
  if (retrato.planosDeManutencao.vencidos) a.push(`${retrato.planosDeManutencao.vencidos} plano(s) de manutenção vencido(s)`);
  if (retrato.checklistsReprovadosUltimos7Dias) a.push(`${retrato.checklistsReprovadosUltimos7Dias} checklist(s) reprovado(s) nos últimos 7 dias`);
  if (alertas.ALTO) a.push(`${alertas.ALTO} abastecimento(s) com consumo acima do normal nos últimos 30 dias`);
  return retrato;
}

export async function retratoFinanceiroExtra(db: Db, hoje: string): Promise<Record<string, unknown>> {
  const agrupar = (tipo: "PAGAR" | "RECEBER", filtro: ReturnType<typeof sql>) =>
    db
      .select({ n: sql<number>`count(*)::int`, soma: sql<number>`coalesce(sum(${finLancamentos.valorCentavos}), 0)::bigint` })
      .from(finLancamentos)
      .where(and(eq(finLancamentos.tipo, tipo), eq(finLancamentos.situacao, "ABERTO"), filtro))
      .then(([r]) => ({ quantidade: r?.n ?? 0, somaCentavos: Number(r?.soma ?? 0) }));
  const vencidas = sql`${finLancamentos.vencimento} < ${hoje}::date`;
  const em7 = sql`${finLancamentos.vencimento} >= ${hoje}::date and ${finLancamentos.vencimento} <= ${somarDias(hoje, 7)}::date`;
  const [pagarVencidas, pagar7, receberVencidas, receber7] = await Promise.all([agrupar("PAGAR", vencidas), agrupar("PAGAR", em7), agrupar("RECEBER", vencidas), agrupar("RECEBER", em7)]);
  const [pend] = await db.select({ n: sql<number>`count(*)::int` }).from(finExtratoLinhas).where(eq(finExtratoLinhas.status, "PENDENTE"));
  const alertas: string[] = [];
  const reais = (c: number) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;
  if (pagarVencidas.quantidade) alertas.push(`${pagarVencidas.quantidade} conta(s) a pagar vencida(s), somando ${reais(pagarVencidas.somaCentavos)}`);
  if (receberVencidas.quantidade) alertas.push(`${receberVencidas.quantidade} conta(s) a receber vencida(s), somando ${reais(receberVencidas.somaCentavos)}`);
  if (pend?.n) alertas.push(`${pend.n} linha(s) de extrato pendente(s) de conciliação`);
  return {
    contasAPagar: { vencidas: pagarVencidas, aVencerEm7Dias: pagar7 },
    contasAReceber: { vencidas: receberVencidas, aVencerEm7Dias: receber7 },
    extratoPendenteDeConciliacao: pend?.n ?? 0,
    alertasFinanceiros: alertas,
  };
}
