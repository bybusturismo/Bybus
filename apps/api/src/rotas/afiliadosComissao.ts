import type { FastifyInstance, FastifyRequest } from "fastify";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { proximoPagamento, type SituacaoComissao } from "@bybus/core";
import type { Contexto } from "../app.js";
import { auditar } from "../auditoria.js";
import { afiliadoPagamentos, afiliados, finLancamentos, marketingConfig } from "../db/schema.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { CHAVE_CORTE, calcularComissoes, desfazerPagamentoComissao, gerarPagamentosComissao, lerCorte } from "../servicos/afiliadosComissao.js";
import { dataIso, hojeSp } from "../servicos/marketingComum.js";

/** Comissões de afiliados: relatório, ranking e pagamento quinzenal (13/11/2026). Valores: só com financeiro:ver ou marketing:ver. */
export async function rotasAfiliadosComissao(app: FastifyInstance, { db, config }: Contexto) {
  const logado = exigir(config);
  const ver = {
    preHandler: async (req: FastifyRequest) => {
      await logado(req);
      if (!pode(req.usuario!, "financeiro:ver") && !pode(req.usuario!, "marketing:ver")) throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta função.");
    },
  };
  const pagar = { preHandler: exigir(config, "financeiro:gerenciar") };
  const escopo = (req: FastifyRequest) => (req.usuario!.todasUnidades ? null : req.usuario!.unidadeIds);

  app.get("/api/afiliados/comissoes", ver, async (req) => {
    const q = z.object({
      de: dataIso, ate: dataIso, por: z.enum(["PASSEIO", "VENDA"]).default("PASSEIO"), afiliadoId: z.string().uuid().optional(),
    }).parse(req.query);
    if (q.ate < q.de) throw new ErroHttp(400, "DADOS_INVALIDOS", "Período inválido.");
    const hoje = hojeSp();
    const todas = await calcularComissoes(db, escopo(req), hoje);
    const itens = todas
      .filter((c) => (!q.afiliadoId || c.afiliadoId === q.afiliadoId))
      .filter((c) => { const d = q.por === "VENDA" ? c.dataVenda : c.dataPasseio; return !!d && d >= q.de && d <= q.ate; })
      .sort((a, b) => (q.por === "VENDA" ? (a.dataVenda ?? "").localeCompare(b.dataVenda ?? "") : a.dataPasseio.localeCompare(b.dataPasseio)));
    const soma = (s: SituacaoComissao) => itens.filter((c) => c.situacao === s).reduce((a, c) => a + c.comissaoCentavos, 0);
    // Ranking: vendas, valor vendido e comissão por afiliado no período (sem as canceladas).
    const porAfiliado = new Map<string, { afiliadoId: string | null; nome: string; reservas: number; vendidoCentavos: number; comissaoCentavos: number }>();
    for (const c of itens) {
      if (c.situacao === "CANCELADA") continue;
      const k = c.afiliadoId ?? c.paytourAfiliadoId;
      const r = porAfiliado.get(k) ?? { afiliadoId: c.afiliadoId, nome: c.afiliadoNome, reservas: 0, vendidoCentavos: 0, comissaoCentavos: 0 };
      r.reservas++; r.vendidoCentavos += c.valorReservaCentavos; r.comissaoCentavos += c.comissaoCentavos;
      porAfiliado.set(k, r);
    }
    // Próximo pagamento: o que já está a pagar e ainda não entrou em pagamento gerado.
    const proximo = proximoPagamento(hoje);
    const aPagarSemLote = todas.filter((c) => c.situacao === "A_PAGAR" && !c.pagamentoId);
    return {
      itens,
      totais: { previstaCentavos: soma("PREVISTA"), aPagarCentavos: soma("A_PAGAR"), pagaCentavos: soma("PAGA"), canceladaCentavos: soma("CANCELADA") },
      ranking: [...porAfiliado.values()].sort((a, b) => b.vendidoCentavos - a.vendidoCentavos),
      pagasForaAte: await lerCorte(db),
      proximoPagamento: { data: proximo, pendentes: aPagarSemLote.length, totalCentavos: aPagarSemLote.reduce((a, c) => a + c.comissaoCentavos, 0) },
    };
  });

  app.get("/api/afiliados/pagamentos", ver, async (req) => {
    const u = req.usuario!;
    const lista = await db.select({
      id: afiliadoPagamentos.id, dataPagamento: afiliadoPagamentos.dataPagamento, periodoDe: afiliadoPagamentos.periodoDe, periodoAte: afiliadoPagamentos.periodoAte,
      totalCentavos: afiliadoPagamentos.totalCentavos, unidadeId: afiliadoPagamentos.unidadeId, afiliado: afiliados.nome, lancamentoId: afiliadoPagamentos.lancamentoId,
      situacaoConta: finLancamentos.situacao,
    }).from(afiliadoPagamentos).innerJoin(afiliados, eq(afiliados.id, afiliadoPagamentos.afiliadoId))
      .innerJoin(finLancamentos, eq(finLancamentos.id, afiliadoPagamentos.lancamentoId))
      .where(u.todasUnidades ? undefined : inArray(afiliadoPagamentos.unidadeId, u.unidadeIds.length ? u.unidadeIds : ["00000000-0000-0000-0000-000000000000"]))
      .orderBy(desc(afiliadoPagamentos.dataPagamento), desc(afiliadoPagamentos.criadoEm)).limit(200);
    return lista;
  });

  // Corte do histórico: comissões de passeios até esta data já foram pagas fora do sistema.
  app.put("/api/afiliados/corte", pagar, async (req) => {
    const { pagasAte } = z.object({ pagasAte: dataIso }).parse(req.body);
    if (pagasAte > hojeSp()) throw new ErroHttp(400, "DATA_FUTURA", "A data de corte não pode ser futura.");
    const antes = await lerCorte(db);
    await db.insert(marketingConfig).values({ chave: CHAVE_CORTE, valor: pagasAte, atualizadoPor: req.usuario!.id })
      .onConflictDoUpdate({ target: marketingConfig.chave, set: { valor: pagasAte, atualizadoEm: new Date(), atualizadoPor: req.usuario!.id } });
    await auditar(db, req, "AFILIADO_CORTE_DEFINIDO", { tipo: "marketing_config", id: CHAVE_CORTE }, { antes, depois: pagasAte });
    return { pagasAte };
  });

  app.post("/api/afiliados/pagamentos", pagar, async (req) => {
    const { dataPagamento } = z.object({ dataPagamento: dataIso }).parse(req.body);
    const r = await gerarPagamentosComissao(db, req.usuario!, dataPagamento, hojeSp());
    await auditar(db, req, "AFILIADO_PAGAMENTO_GERADO", { tipo: "afiliado_pagamento", id: dataPagamento }, r);
    return r;
  });

  app.delete("/api/afiliados/pagamentos/:id", pagar, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = await desfazerPagamentoComissao(db, req.usuario!, id);
    await auditar(db, req, "AFILIADO_PAGAMENTO_DESFEITO", { tipo: "afiliado_pagamento", id }, r);
    return r;
  });
}
