import { and, eq, gt, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { dataPagamentoComissao, periodoDoPagamento, ratearComissao, situacaoComissao, type SituacaoComissao } from "@bybus/core";
import type { Db } from "../db/cliente.js";
import {
  afiliadoPagamentoItens, afiliadoPagamentos, afiliados, finCategorias, finLancamentos, marketingConfig, passageiros, passeios, reservas, saidas, vendas,
} from "../db/schema.js";
import { ErroHttp, type UsuarioSessao } from "../seguranca/sessao.js";
import { garantirPlano } from "./financeiro.js";

/**
 * Comissões de afiliados (13/11/2026). O valor vem da Paytour (comissão do pedido, rateada entre as reservas pelo valor de
 * cada uma). As comissões ainda não pagas são calculadas na hora (acompanham mudança de data, cancelamento e embarque);
 * no pagamento quinzenal o valor fica congelado em `afiliado_pagamento_itens` e vira conta a pagar no financeiro.
 */

export interface ComissaoReserva {
  reservaId: string;
  pedidoCodigo: string;
  afiliadoId: string | null;
  afiliadoNome: string;
  paytourAfiliadoId: string;
  unidadeId: string | null;
  passeio: string;
  dataVenda: string | null;
  dataPasseio: string;
  valorReservaCentavos: number;
  comissaoCentavos: number;
  situacao: SituacaoComissao;
  /** Dia em que é (ou foi) paga: o do pagamento gerado, ou o previsto pela regra quinzenal. */
  dataPagamento: string;
  pagamentoId: string | null;
}

/**
 * Corte: comissões de passeios até esta data já foram pagas fora do sistema (pela rotina antiga) e contam como pagas.
 * Sem o corte, gerar pagamento é bloqueado (evita pagar duas vezes o histórico).
 */
export const CHAVE_CORTE = "comissoes_pagas_ate";
export async function lerCorte(db: Db): Promise<string | null> {
  const [c] = await db.select({ valor: marketingConfig.valor }).from(marketingConfig).where(eq(marketingConfig.chave, CHAVE_CORTE));
  return c?.valor ?? null;
}

const diaSp = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d) : null);

/** Cadastra no sistema os afiliados da Paytour que aparecem nas vendas e ainda não estão ligados (código PT-<id>). */
export async function sincronizarAfiliadosPaytour(db: Db, nomes: Record<string, string>) {
  const usados = await db.selectDistinct({ id: vendas.afiliadoId }).from(vendas).where(isNotNull(vendas.afiliadoId));
  const ligados = new Set((await db.select({ id: afiliados.paytourAfiliadoId }).from(afiliados).where(isNotNull(afiliados.paytourAfiliadoId))).map((x) => x.id));
  let criados = 0;
  for (const { id } of usados) {
    if (!id || ligados.has(id)) continue;
    const codigo = `PT-${id}`.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 24);
    const r = await db.insert(afiliados).values({ nome: nomes[id] || `Afiliado Paytour ${id}`, tipo: "PARCEIRO", codigo, paytourAfiliadoId: id }).onConflictDoNothing().returning({ id: afiliados.id });
    criados += r.length;
  }
  return { criados };
}

/** Pagamentos cuja conta a pagar foi excluída no financeiro deixam de valer (as comissões voltam a ficar a pagar). */
async function limparPagamentosSemConta(db: Db) {
  await db.delete(afiliadoPagamentos).where(sql`not exists (select 1 from fin_lancamentos l where l.id = ${afiliadoPagamentos.lancamentoId})`);
}

export async function calcularComissoes(db: Db, unidadeIds: string[] | null, hoje: string): Promise<ComissaoReserva[]> {
  await limparPagamentosSemConta(db);
  const linhas = await db.select({
    reservaId: reservas.id, vendaId: reservas.vendaId, status: reservas.status, valor: reservas.valorCentavos,
    dataPasseio: saidas.data, passeio: passeios.nome, unidadeId: passeios.unidadeId,
    pedidoCodigo: vendas.pedidoCodigo, compra: vendas.dataHoraCompra, paytourAfiliadoId: vendas.afiliadoId, comissao: vendas.afiliadoComissaoCentavos,
  }).from(reservas)
    .innerJoin(vendas, eq(vendas.id, reservas.vendaId))
    .innerJoin(saidas, eq(saidas.id, reservas.saidaId))
    .innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .where(and(isNotNull(vendas.afiliadoId), gt(vendas.afiliadoComissaoCentavos, 0)));
  if (!linhas.length) return [];
  // Rateio pelo pedido inteiro (todas as reservas do pedido, mesmo de outra praça), depois o filtro de praça.
  const porVenda = new Map<string, typeof linhas>();
  for (const l of linhas) porVenda.set(l.vendaId!, [...(porVenda.get(l.vendaId!) ?? []), l]);
  const parte = new Map<string, number>();
  for (const lista of porVenda.values()) {
    const ordenada = [...lista].sort((a, b) => a.reservaId.localeCompare(b.reservaId));
    ratearComissao(ordenada[0]!.comissao ?? 0, ordenada.map((x) => x.valor ?? 0)).forEach((v, i) => parte.set(ordenada[i]!.reservaId, v));
  }
  const visiveis = unidadeIds === null ? linhas : linhas.filter((l) => l.unidadeId && unidadeIds.includes(l.unidadeId));
  if (!visiveis.length) return [];
  const ids = visiveis.map((l) => l.reservaId);
  const embarque = new Map<string, boolean | null>();
  for (let i = 0; i < ids.length; i += 1000) {
    const fatia = ids.slice(i, i + 1000);
    const r = await db.select({
      reservaId: passageiros.reservaId,
      total: sql<number>`count(*)`.mapWith(Number),
      embarcou: sql<number>`count(*) filter (where ${passageiros.embarque} = 'EMBARCOU')`.mapWith(Number),
      faltou: sql<number>`count(*) filter (where ${passageiros.embarque} = 'NO_SHOW')`.mapWith(Number),
    }).from(passageiros).where(inArray(passageiros.reservaId, fatia)).groupBy(passageiros.reservaId);
    for (const x of r) embarque.set(x.reservaId, x.embarcou > 0 ? true : x.total > 0 && x.faltou === x.total ? false : null);
  }
  const pagos = await db.select({
    reservaId: afiliadoPagamentoItens.reservaId, valor: afiliadoPagamentoItens.valorCentavos, pagamentoId: afiliadoPagamentos.id,
    dataPagamento: afiliadoPagamentos.dataPagamento, situacaoConta: finLancamentos.situacao,
  }).from(afiliadoPagamentoItens)
    .innerJoin(afiliadoPagamentos, eq(afiliadoPagamentos.id, afiliadoPagamentoItens.pagamentoId))
    .innerJoin(finLancamentos, eq(finLancamentos.id, afiliadoPagamentos.lancamentoId))
    .where(inArray(afiliadoPagamentoItens.reservaId, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]));
  const pagoPor = new Map(pagos.map((p) => [p.reservaId, p]));
  const cadastro = await db.select({ id: afiliados.id, nome: afiliados.nome, paytour: afiliados.paytourAfiliadoId }).from(afiliados).where(isNotNull(afiliados.paytourAfiliadoId));
  const afiliadoDe = new Map(cadastro.map((a) => [a.paytour!, a]));
  const corte = await lerCorte(db);

  return visiveis.map((l) => {
    const p = pagoPor.get(l.reservaId);
    const a = afiliadoDe.get(l.paytourAfiliadoId!);
    const situacao: SituacaoComissao = p
      ? (p.situacaoConta === "REALIZADO" ? "PAGA" : "A_PAGAR")
      : situacaoComissao({ reservaCancelada: l.status === "CANCELADA", dataPasseio: l.dataPasseio, hoje, compareceu: embarque.get(l.reservaId) ?? null, paga: !!corte && l.dataPasseio <= corte });
    return {
      reservaId: l.reservaId, pedidoCodigo: l.pedidoCodigo, afiliadoId: a?.id ?? null, afiliadoNome: a?.nome ?? `Afiliado Paytour ${l.paytourAfiliadoId}`,
      paytourAfiliadoId: l.paytourAfiliadoId!, unidadeId: l.unidadeId, passeio: l.passeio, dataVenda: diaSp(l.compra), dataPasseio: l.dataPasseio,
      valorReservaCentavos: l.valor ?? 0, comissaoCentavos: p ? p.valor : (parte.get(l.reservaId) ?? 0),
      situacao, dataPagamento: p ? p.dataPagamento : dataPagamentoComissao(l.dataPasseio), pagamentoId: p?.pagamentoId ?? null,
    };
  });
}

/**
 * Gera o pagamento quinzenal (dia 01 ou 16): junta as comissões a pagar de passeios realizados até o fim do período (inclui
 * as que ficaram de quinzenas anteriores) e cria uma conta a pagar por afiliado e praça, com vencimento no dia do pagamento.
 */
export async function gerarPagamentosComissao(db: Db, u: UsuarioSessao, dataPagamento: string, hoje: string) {
  let periodo: { de: string; ate: string };
  try {
    periodo = periodoDoPagamento(dataPagamento);
  } catch (e) {
    throw new ErroHttp(400, "DATA_INVALIDA", (e as Error).message);
  }
  if (hoje <= periodo.ate) throw new ErroHttp(409, "PERIODO_EM_ANDAMENTO", `Os passeios de ${periodo.de.split("-").reverse().join("/")} a ${periodo.ate.split("-").reverse().join("/")} ainda não terminaram: gere o pagamento a partir do dia seguinte ao fim do período.`);
  if (!(await lerCorte(db))) throw new ErroHttp(409, "SEM_CORTE", "Antes do primeiro pagamento, informe até que data de passeio as comissões já foram pagas fora do sistema.");
  const todas = await calcularComissoes(db, u.todasUnidades ? null : u.unidadeIds, hoje);
  const elegiveis = todas.filter((c) => c.situacao === "A_PAGAR" && !c.pagamentoId && c.afiliadoId && c.comissaoCentavos > 0 && c.dataPasseio <= periodo.ate);
  if (!elegiveis.length) return { pagamentos: 0, comissoes: 0, totalCentavos: 0 };
  await garantirPlano(db);
  const [cat] = await db.select({ id: finCategorias.id }).from(finCategorias).where(eq(finCategorias.codigo, "DESP_AFILIADOS"));
  if (!cat) throw new ErroHttp(500, "SEM_CATEGORIA", "Categoria de afiliados não encontrada no plano de contas.");
  const grupos = new Map<string, ComissaoReserva[]>();
  for (const c of elegiveis) grupos.set(`${c.afiliadoId}|${c.unidadeId ?? ""}`, [...(grupos.get(`${c.afiliadoId}|${c.unidadeId ?? ""}`) ?? []), c]);
  let pagamentos = 0, total = 0;
  const br = (d: string) => d.split("-").reverse().join("/");
  for (const lista of grupos.values()) {
    const soma = lista.reduce((a, c) => a + c.comissaoCentavos, 0);
    const primeiro = lista.reduce((a, c) => (c.dataPasseio < a ? c.dataPasseio : a), lista[0]!.dataPasseio);
    await db.transaction(async (tx) => {
      // Outra pessoa pode ter gerado ao mesmo tempo: a reserva só entra uma vez (único em afiliado_pagamento_itens).
      const ja = await tx.select({ id: afiliadoPagamentoItens.reservaId }).from(afiliadoPagamentoItens).where(inArray(afiliadoPagamentoItens.reservaId, lista.map((c) => c.reservaId)));
      if (ja.length) return;
      const [l] = await tx.insert(finLancamentos).values({
        tipo: "PAGAR", descricao: `Comissão de afiliado — passeios de ${br(primeiro < periodo.de ? primeiro : periodo.de)} a ${br(periodo.ate)} (${lista.length} reserva${lista.length > 1 ? "s" : ""})`,
        contraparte: lista[0]!.afiliadoNome, categoriaId: cat.id, unidadeId: lista[0]!.unidadeId, valorCentavos: soma,
        competencia: periodo.ate, vencimento: dataPagamento, origem: "AFILIADOS", criadoPor: u.id,
      }).returning({ id: finLancamentos.id });
      const [p] = await tx.insert(afiliadoPagamentos).values({
        afiliadoId: lista[0]!.afiliadoId!, unidadeId: lista[0]!.unidadeId, dataPagamento, periodoDe: periodo.de, periodoAte: periodo.ate,
        totalCentavos: soma, lancamentoId: l!.id, criadoPor: u.id,
      }).returning({ id: afiliadoPagamentos.id });
      await tx.insert(afiliadoPagamentoItens).values(lista.map((c) => ({ pagamentoId: p!.id, reservaId: c.reservaId, valorCentavos: c.comissaoCentavos })));
      pagamentos++;
      total += soma;
    });
  }
  return { pagamentos, comissoes: elegiveis.length, totalCentavos: total };
}

/** Desfaz um pagamento gerado (só enquanto a conta a pagar não foi paga): apaga a conta e devolve as comissões. */
export async function desfazerPagamentoComissao(db: Db, u: UsuarioSessao, id: string) {
  const [p] = await db.select().from(afiliadoPagamentos).where(eq(afiliadoPagamentos.id, id));
  if (!p || !(u.todasUnidades || (p.unidadeId && u.unidadeIds.includes(p.unidadeId)))) throw new ErroHttp(404, "NAO_ENCONTRADO", "Pagamento não encontrado.");
  const [l] = await db.select({ situacao: finLancamentos.situacao }).from(finLancamentos).where(eq(finLancamentos.id, p.lancamentoId));
  if (l?.situacao === "REALIZADO") throw new ErroHttp(409, "JA_PAGO", "Esta comissão já foi paga no financeiro. Reabra a conta a pagar antes de desfazer.");
  const conciliado = await db.execute(sql`select 1 from fin_extrato_linhas where lancamento_id = ${p.lancamentoId} limit 1`);
  if ((conciliado as unknown as { rows: unknown[] }).rows?.length) throw new ErroHttp(409, "CONCILIADO", "A conta a pagar está conciliada com o extrato.");
  await db.transaction(async (tx) => {
    await tx.delete(afiliadoPagamentos).where(eq(afiliadoPagamentos.id, id));
    await tx.delete(finLancamentos).where(and(eq(finLancamentos.id, p.lancamentoId), notInArray(finLancamentos.situacao, ["REALIZADO"])));
  });
  return { ok: true, totalCentavos: p.totalCentavos };
}
