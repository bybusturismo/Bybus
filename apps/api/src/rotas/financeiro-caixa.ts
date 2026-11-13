import { LINHAS_FINANCEIRO, somarDiasIso, suspeitosDaDiferenca, type MovimentoConferencia } from "@bybus/core";
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { finCategorias, finExtratoLinhas, finFechamentosCaixa, finLancamentos, finRevendas } from "../db/schema.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { filtroPraca, garantirConta, garantirPlano, hojeSP, naoConciliadoSql, saldosDasContas, validarPracaDoRegistro } from "../servicos/financeiro.js";
import { movimentosPorDia } from "../servicos/financeiro-saldos.js";
import { centavos, dataIso, uuid, valorPositivo } from "./financeiro-comum.js";

interface Guardas {
  ver: { preHandler: (req: FastifyRequest) => Promise<void> };
  gerenciar: { preHandler: (req: FastifyRequest) => Promise<void> };
}

/** Saldo dia a dia, fechamento do caixa em dinheiro (quiosque) e revenda de serviços de terceiros. */
export async function rotasFinanceiroCaixa(app: FastifyInstance, { db }: Contexto, { ver, gerenciar }: Guardas) {
  // ---------------------------------------------------------------- saldo dia a dia de uma conta
  app.get("/api/financeiro/contas/:id/saldo-diario", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const q = z.object({ de: dataIso, ate: dataIso }).parse(req.query);
    if (q.ate < q.de) throw new ErroHttp(400, "PERIODO_INVALIDO", "A data final é anterior à inicial.");
    const dias = Math.round((Date.parse(q.ate) - Date.parse(q.de)) / 86_400_000) + 1;
    if (dias > 120) throw new ErroHttp(400, "PERIODO_GRANDE", "Escolha um período de até 120 dias.");
    const conta = await garantirConta(db, req.usuario!, id);
    let saldo = (await saldosDasContas(db, [conta], q.de)).get(conta.id) ?? 0;
    const inicial = saldo;
    const mov = await movimentosPorDia(db, conta, q.de, q.ate);
    const lista = [];
    for (let i = 0; i < dias; i++) {
      const data = somarDiasIso(q.de, i);
      const m = mov.get(data) ?? { entradasCentavos: 0, saidasCentavos: 0 };
      saldo += m.entradasCentavos - m.saidasCentavos;
      lista.push({ data, entradasCentavos: m.entradasCentavos, saidasCentavos: m.saidasCentavos, saldoFinalCentavos: saldo });
    }
    return { conta: { id: conta.id, nome: conta.nome, tipo: conta.tipo }, saldoInicialCentavos: inicial, dias: lista };
  });

  // ---------------------------------------------------------------- conferência com o saldo do banco (13/11/2026)
  // O dono digita o saldo que o banco mostra num dia; o sistema compara e lista o que pode explicar a diferença.
  app.get("/api/financeiro/contas/:id/conferencia", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const q = z.object({ data: dataIso, saldoBancoCentavos: z.coerce.number().int().min(-100_000_000_00).max(100_000_000_00) }).parse(req.query);
    if (q.data > hojeSP()) throw new ErroHttp(400, "DATA_FUTURA", "Escolha hoje ou um dia que já passou.");
    const conta = await garantirConta(db, req.usuario!, id);
    const ate = q.data;
    const de = conta.saldoInicialEm ?? "1900-01-01";
    const saldoSistema = (await saldosDasContas(db, [conta], somarDiasIso(ate, 1))).get(conta.id) ?? 0;
    // Os mesmos movimentos que formam o saldo (ver saldosDasContas): linhas da conta e lançamentos baixados sem conciliar
    // fora dos períodos de extrato importado.
    const linhas = await db.select().from(finExtratoLinhas).where(and(eq(finExtratoLinhas.contaId, conta.id), gte(finExtratoLinhas.data, de), lte(finExtratoLinhas.data, ate)));
    const lancs = await db.select().from(finLancamentos).where(and(
      eq(finLancamentos.contaId, conta.id), eq(finLancamentos.situacao, "REALIZADO"), isNotNull(finLancamentos.valorPagoCentavos), naoConciliadoSql,
      sql`not exists (select 1 from fin_extratos e where e.conta_id = ${finLancamentos.contaId} and e.inicio <= ${finLancamentos.pagoEm} and e.fim >= ${finLancamentos.pagoEm})`,
      gte(finLancamentos.pagoEm, de), lte(finLancamentos.pagoEm, ate),
    ));
    const movs: MovimentoConferencia[] = [
      ...linhas.map((l) => ({ id: l.id, origem: "LINHA" as const, data: l.data, valorCentavos: l.valorCentavos, descricao: l.descricao, transferencia: l.status === "TRANSFERENCIA", criadoPelaPlanilha: !!l.importacaoId })),
      ...lancs.map((l) => ({ id: l.id, origem: "LANCAMENTO" as const, data: l.pagoEm!, valorCentavos: l.tipo === "RECEBER" ? l.valorPagoCentavos! : -l.valorPagoCentavos!, descricao: l.descricao, transferencia: false, criadoPelaPlanilha: !!l.importacaoId })),
    ];
    const diferenca = saldoSistema - q.saldoBancoCentavos;
    const soma = (f: (m: MovimentoConferencia) => boolean) => movs.filter(f).reduce((a, m) => a + m.valorCentavos, 0);
    return {
      conta: { id: conta.id, nome: conta.nome }, data: ate,
      saldoSistemaCentavos: saldoSistema, saldoBancoCentavos: q.saldoBancoCentavos, diferencaCentavos: diferenca,
      composicao: {
        saldoInicialCentavos: conta.saldoInicialCentavos, saldoInicialEm: conta.saldoInicialEm,
        transferenciasCentavos: soma((m) => m.transferencia), extratoCentavos: soma((m) => m.origem === "LINHA" && !m.transferencia),
        entradasCentavos: soma((m) => m.origem === "LANCAMENTO" && m.valorCentavos > 0), saidasCentavos: soma((m) => m.origem === "LANCAMENTO" && m.valorCentavos < 0),
      },
      suspeitos: diferenca === 0 ? [] : suspeitosDaDiferenca(movs, diferenca),
    };
  });

  // ---------------------------------------------------------------- caixa em dinheiro: fechamento do dia
  async function calcularDia(contaId: string, data: string, conta: Awaited<ReturnType<typeof garantirConta>>) {
    const inicial = (await saldosDasContas(db, [conta], data)).get(contaId) ?? 0;
    const m = (await movimentosPorDia(db, conta, data, data)).get(data) ?? { entradasCentavos: 0, saidasCentavos: 0 };
    return { saldoInicialCentavos: inicial, entradasCentavos: m.entradasCentavos, saidasCentavos: m.saidasCentavos, saldoCalculadoCentavos: inicial + m.entradasCentavos - m.saidasCentavos };
  }

  app.get("/api/financeiro/caixa/dia", ver, async (req) => {
    const q = z.object({ contaId: uuid, data: dataIso }).parse(req.query);
    const conta = await garantirConta(db, req.usuario!, q.contaId);
    if (conta.tipo !== "CAIXA") throw new ErroHttp(400, "NAO_E_CAIXA", "O fechamento é só para a conta de caixa em dinheiro.");
    const [fechado] = await db.select().from(finFechamentosCaixa).where(and(eq(finFechamentosCaixa.contaId, conta.id), eq(finFechamentosCaixa.data, q.data)));
    const calculo = await calcularDia(conta.id, q.data, conta);
    const itens = await db.select({ id: finLancamentos.id, tipo: finLancamentos.tipo, descricao: finLancamentos.descricao, valorPagoCentavos: finLancamentos.valorPagoCentavos, categoria: finCategorias.nome })
      .from(finLancamentos).innerJoin(finCategorias, eq(finCategorias.id, finLancamentos.categoriaId))
      .where(and(eq(finLancamentos.contaId, conta.id), eq(finLancamentos.situacao, "REALIZADO"), eq(finLancamentos.pagoEm, q.data)));
    const recentes = await db.select().from(finFechamentosCaixa).where(eq(finFechamentosCaixa.contaId, conta.id)).orderBy(desc(finFechamentosCaixa.data)).limit(10);
    return { conta: { id: conta.id, nome: conta.nome }, data: q.data, ...calculo, fechamento: fechado ?? null, lancamentos: itens, recentes };
  });

  app.post("/api/financeiro/caixa/fechar", gerenciar, async (req) => {
    const corpo = z.object({ contaId: uuid, data: dataIso, saldoContadoCentavos: centavos.min(-100_000_000_00), observacao: z.string().trim().max(300).nullish() }).parse(req.body);
    const conta = await garantirConta(db, req.usuario!, corpo.contaId);
    if (conta.tipo !== "CAIXA") throw new ErroHttp(400, "NAO_E_CAIXA", "O fechamento é só para a conta de caixa em dinheiro.");
    if (corpo.data > hojeSP()) throw new ErroHttp(400, "DATA_FUTURA", "Não é possível fechar um dia futuro.");
    const calculo = await calcularDia(conta.id, corpo.data, conta);
    try {
      const [f] = await db.insert(finFechamentosCaixa).values({
        contaId: conta.id, data: corpo.data, ...calculo, saldoContadoCentavos: corpo.saldoContadoCentavos, diferencaCentavos: corpo.saldoContadoCentavos - calculo.saldoCalculadoCentavos,
        observacao: corpo.observacao ?? null, fechadoPor: req.usuario!.id,
      }).returning();
      await auditar(db, req, "FIN_CAIXA_FECHADO", { tipo: "fin_conta", id: conta.id }, { data: corpo.data, diferencaCentavos: f!.diferencaCentavos, saldoContadoCentavos: f!.saldoContadoCentavos });
      return f;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "CAIXA_JA_FECHADO", "Este dia do caixa já foi fechado.");
      throw e;
    }
  });

  // ---------------------------------------------------------------- revenda de serviços de terceiros
  const NATUREZA_AVISO = "Tratamento contábil da revenda (só a margem como receita) a confirmar com o contador.";

  app.post("/api/financeiro/revendas", gerenciar, async (req) => {
    const u = req.usuario!;
    const corpo = z.object({
      descricao: z.string().trim().min(2).max(200), fornecedor: z.string().trim().max(150).nullish(), vendedor: z.string().trim().max(150).nullish(),
      dataVenda: dataIso, vencimentoRepasse: dataIso, valorVendaCentavos: valorPositivo, valorRepasseCentavos: centavos.min(0), comissaoCentavos: centavos.min(0).default(0),
      unidadeId: uuid.nullish(), linha: z.enum(LINHAS_FINANCEIRO).nullish(),
    }).parse(req.body);
    const unidadeId = await validarPracaDoRegistro(db, u, corpo.unidadeId);
    await garantirPlano(db);
    const cats = await db.select().from(finCategorias).where(inArray(finCategorias.codigo, ["REC_REVENDA", "DESP_REVENDA_REPASSE", "DESP_COMISSAO_RH"]));
    const cat = (c: string) => cats.find((x) => x.codigo === c)!.id;
    const r = await db.transaction(async (tx) => {
      const base = { unidadeId, linha: corpo.linha ?? null, origem: "MANUAL", criadoPor: u.id, competencia: corpo.dataVenda };
      const [venda] = await tx.insert(finLancamentos).values({ ...base, tipo: "RECEBER", descricao: `Revenda: ${corpo.descricao}`, contraparte: null, categoriaId: cat("REC_REVENDA"), valorCentavos: corpo.valorVendaCentavos, vencimento: corpo.dataVenda }).returning({ id: finLancamentos.id });
      let repasseId: string | null = null;
      if (corpo.valorRepasseCentavos > 0) {
        const [rp] = await tx.insert(finLancamentos).values({ ...base, tipo: "PAGAR", descricao: `Repasse: ${corpo.descricao}`, contraparte: corpo.fornecedor ?? null, categoriaId: cat("DESP_REVENDA_REPASSE"), valorCentavos: corpo.valorRepasseCentavos, vencimento: corpo.vencimentoRepasse }).returning({ id: finLancamentos.id });
        repasseId = rp!.id;
      }
      let comissaoId: string | null = null;
      if (corpo.comissaoCentavos > 0) {
        const [c] = await tx.insert(finLancamentos).values({ ...base, tipo: "PAGAR", descricao: `Comissão: ${corpo.descricao}`, contraparte: corpo.vendedor ?? null, categoriaId: cat("DESP_COMISSAO_RH"), valorCentavos: corpo.comissaoCentavos, vencimento: corpo.vencimentoRepasse }).returning({ id: finLancamentos.id });
        comissaoId = c!.id;
      }
      const [rev] = await tx.insert(finRevendas).values({
        descricao: corpo.descricao, fornecedor: corpo.fornecedor ?? null, vendedor: corpo.vendedor ?? null, unidadeId, dataVenda: corpo.dataVenda,
        valorVendaCentavos: corpo.valorVendaCentavos, valorRepasseCentavos: corpo.valorRepasseCentavos, comissaoCentavos: corpo.comissaoCentavos,
        vendaLancamentoId: venda!.id, repasseLancamentoId: repasseId, comissaoLancamentoId: comissaoId, criadoPor: u.id,
      }).returning();
      return rev!;
    });
    await auditar(db, req, "FIN_REVENDA_CRIADA", { tipo: "fin_revenda", id: r.id }, { valorVendaCentavos: r.valorVendaCentavos, valorRepasseCentavos: r.valorRepasseCentavos, comissaoCentavos: r.comissaoCentavos });
    return { ...r, margemCentavos: r.valorVendaCentavos - r.valorRepasseCentavos, aviso: NATUREZA_AVISO };
  });

  app.get("/api/financeiro/revendas", ver, async (req) => {
    const q = z.object({ de: dataIso.optional(), ate: dataIso.optional() }).parse(req.query);
    const lista = await db.select().from(finRevendas).where(and(filtroPraca(req.usuario!, finRevendas.unidadeId), q.de ? gte(finRevendas.dataVenda, q.de) : undefined, q.ate ? lte(finRevendas.dataVenda, q.ate) : undefined)).orderBy(desc(finRevendas.dataVenda)).limit(300);
    return { aviso: NATUREZA_AVISO, itens: lista.map((r) => ({ ...r, margemCentavos: r.valorVendaCentavos - r.valorRepasseCentavos })) };
  });
}
