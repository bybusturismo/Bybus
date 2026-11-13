import {
  CANAIS, FORMAS_PAGAMENTO, LINHAS_FINANCEIRO, TIPOS_CATEGORIA, TIPOS_CONTA_FINANCEIRA,
  calcularBaixa, faturaDaData, fimDoMes, inicioDaSemana, montarDre, montarDreGerencial, montarFluxoSemanal, parcelar, somarDiasIso, somarMeses,
  type CategoriaInfo, type LancamentoDre, type LancamentoRelatorio,
} from "@bybus/core";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { finCategorias, finContas, finExtratoLinhas, finLancamentos, finRegras } from "../db/schema.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import {
  conciliadoSql, estaConciliado, filtroPraca, garantirCaixaAberto, garantirRegra, naoConciliadoSql, validarRegra, filtroPracaEscolhida, garantirConta, garantirLancamento, garantirPlano, hojeSP, saldosDasContas,
  validarCategoria, validarPracaDoRegistro,
} from "../servicos/financeiro.js";
import { centavos, dataIso, mesIso, naoNegativo, uuid, valorPositivo, veiculoOpcional } from "./financeiro-comum.js";
import { rotasFinanceiroExtrato } from "./financeiro-extrato.js";
import { rotasFinanceiroCaixa } from "./financeiro-caixa.js";
import { rotasFinanceiroPlanilha } from "./financeiro-planilha.js";



export async function rotasFinanceiro(app: FastifyInstance, ctx: Contexto) {
  const { db, config } = ctx;
  // "gerenciar" também permite consultar (quem lança precisa enxergar o que lançou).
  const ver = {
    preHandler: async (req: Parameters<ReturnType<typeof exigir>>[0]) => {
      await exigir(config)(req);
      if (!pode(req.usuario!, "financeiro:ver") && !pode(req.usuario!, "financeiro:gerenciar")) throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta função.");
    },
  };
  const gerenciar = { preHandler: exigir(config, "financeiro:gerenciar") };

  // ------------------------------------------------------------------ contas
  const esquemaConta = z.object({
    nome: z.string().trim().min(2).max(100),
    tipo: z.enum(TIPOS_CONTA_FINANCEIRA),
    unidadeId: uuid.nullish(),
    banco: z.string().trim().max(60).nullish(),
    finalConta: z.string().trim().regex(/^[0-9A-Za-z-]{1,8}$/, "Informe só os últimos dígitos (até 8).").nullish().or(z.literal("")),
    saldoInicialCentavos: centavos.min(-100_000_000_00).default(0),
    saldoInicialEm: dataIso.nullish(),
    diaFechamento: z.number().int().min(1).max(31).nullish(),
    diaVencimento: z.number().int().min(1).max(31).nullish(),
    contaPagamentoId: uuid.nullish(),
    ativa: z.boolean().default(true),
  });

  async function validarContaPagamento(u: NonNullable<Parameters<typeof garantirConta>[1]>, id: string | null | undefined) {
    if (!id) return;
    const c = await garantirConta(db, u, id);
    if (c.tipo === "CARTAO") throw new ErroHttp(400, "CONTA_INVALIDA", "A conta que paga a fatura não pode ser um cartão.");
  }

  app.get("/api/financeiro/contas", ver, async (req) => {
    const u = req.usuario!;
    const contas = await db.select().from(finContas).where(filtroPraca(u, finContas.unidadeId)).orderBy(asc(finContas.tipo), asc(finContas.nome));
    const saldos = await saldosDasContas(db, contas);
    const pend = contas.length
      ? await db.select({ contaId: finExtratoLinhas.contaId, n: sql<number>`count(*)`.mapWith(Number) }).from(finExtratoLinhas)
        .where(and(inArray(finExtratoLinhas.contaId, contas.map((c) => c.id)), eq(finExtratoLinhas.status, "PENDENTE"))).groupBy(finExtratoLinhas.contaId)
      : [];
    return contas.map((c) => ({ ...c, saldoCentavos: saldos.get(c.id) ?? 0, linhasPendentes: pend.find((p) => p.contaId === c.id)?.n ?? 0 }));
  });

  app.post("/api/financeiro/contas", gerenciar, async (req) => {
    const u = req.usuario!;
    const corpo = esquemaConta.parse(req.body);
    const unidadeId = await validarPracaDoRegistro(db, u, corpo.unidadeId);
    if (corpo.tipo === "CARTAO" && (!corpo.diaFechamento || !corpo.diaVencimento)) throw new ErroHttp(400, "CARTAO_SEM_CICLO", "Cartão de crédito precisa do dia de fechamento e do dia de vencimento da fatura.");
    await validarContaPagamento(u, corpo.contaPagamentoId);
    const [c] = await db.insert(finContas).values({
      ...corpo, unidadeId, finalConta: corpo.finalConta || null, saldoInicialEm: corpo.saldoInicialEm ?? null,
      ...(corpo.tipo === "CARTAO" ? {} : { diaFechamento: null, diaVencimento: null, contaPagamentoId: null }),
    }).returning();
    await auditar(db, req, "FIN_CONTA_CRIADA", { tipo: "fin_conta", id: c!.id }, { nome: c!.nome, tipo: c!.tipo });
    return c;
  });

  app.patch("/api/financeiro/contas/:id", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = esquemaConta.partial().parse(req.body);
    const atual = await garantirConta(db, u, id);
    if (corpo.unidadeId !== undefined && corpo.unidadeId !== atual.unidadeId) corpo.unidadeId = await validarPracaDoRegistro(db, u, corpo.unidadeId);
    if (corpo.tipo && corpo.tipo !== atual.tipo) {
      const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(finExtratoLinhas).where(eq(finExtratoLinhas.contaId, id));
      if (n > 0) throw new ErroHttp(409, "TIPO_BLOQUEADO", "Não é possível mudar o tipo de uma conta que já tem extrato importado.");
    }
    const tipo = corpo.tipo ?? atual.tipo;
    if (tipo === "CARTAO" && !((corpo.diaFechamento ?? atual.diaFechamento) && (corpo.diaVencimento ?? atual.diaVencimento))) throw new ErroHttp(400, "CARTAO_SEM_CICLO", "Cartão de crédito precisa do dia de fechamento e do dia de vencimento da fatura.");
    await validarContaPagamento(u, corpo.contaPagamentoId);
    if (corpo.contaPagamentoId === id) throw new ErroHttp(400, "CONTA_INVALIDA", "A conta não pode pagar a própria fatura.");
    const { finalConta, ...resto } = corpo;
    const [c] = await db.update(finContas).set({ ...resto, ...(finalConta !== undefined ? { finalConta: finalConta || null } : {}) }).where(eq(finContas.id, id)).returning();
    await auditar(db, req, "FIN_CONTA_ALTERADA", { tipo: "fin_conta", id }, { campos: Object.keys(corpo) });
    return c;
  });

  // ------------------------------------------------------------------ categorias e regras
  app.get("/api/financeiro/categorias", ver, async () => {
    await garantirPlano(db);
    return db.select().from(finCategorias).orderBy(asc(finCategorias.tipo), asc(finCategorias.ordem), asc(finCategorias.nome));
  });

  app.post("/api/financeiro/categorias", gerenciar, async (req) => {
    const corpo = z.object({
      nome: z.string().trim().min(2).max(80), tipo: z.enum(TIPOS_CATEGORIA), grupo: z.string().trim().min(2).max(60), ordem: z.number().int().min(0).max(10_000).default(500),
    }).parse(req.body);
    const base = corpo.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);
    const codigo = `${corpo.tipo === "RECEITA" ? "REC" : "DESP"}_${base || "CATEGORIA"}_${randomUUID().slice(0, 4).toUpperCase()}`;
    const [c] = await db.insert(finCategorias).values({ ...corpo, codigo }).returning();
    await auditar(db, req, "FIN_CATEGORIA_CRIADA", { tipo: "fin_categoria", id: c!.id }, { nome: c!.nome });
    return c;
  });

  app.patch("/api/financeiro/categorias/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({ nome: z.string().trim().min(2).max(80), grupo: z.string().trim().min(2).max(60), ordem: z.number().int().min(0).max(10_000), ativa: z.boolean() }).partial().parse(req.body);
    const [c] = await db.update(finCategorias).set(corpo).where(eq(finCategorias.id, id)).returning();
    if (!c) throw new ErroHttp(404, "NAO_ENCONTRADO", "Categoria não encontrada.");
    await auditar(db, req, "FIN_CATEGORIA_ALTERADA", { tipo: "fin_categoria", id }, corpo);
    return c;
  });

  const esquemaRegra = z.object({
    texto: z.string().trim().min(3, "Use ao menos 3 letras.").max(80),
    tipo: z.enum(TIPOS_CATEGORIA).nullish(),
    categoriaId: uuid,
    unidadeId: uuid.nullish(),
    linha: z.enum(LINHAS_FINANCEIRO).nullish(),
    prioridade: z.number().int().min(0).max(100).default(0),
    ativa: z.boolean().default(true),
  });

  app.get("/api/financeiro/regras", ver, async (req) => {
    const u = req.usuario!;
    const todas = await db.select().from(finRegras).orderBy(asc(finRegras.texto));
    return u.todasUnidades ? todas : todas.filter((r) => !r.unidadeId || u.unidadeIds.includes(r.unidadeId));
  });

  app.post("/api/financeiro/regras", gerenciar, async (req) => {
    const u = req.usuario!;
    const corpo = esquemaRegra.parse(req.body);
    const cat = await validarRegra(db, u, corpo);
    const [r] = await db.insert(finRegras).values({ ...corpo, unidadeId: corpo.unidadeId ?? null, tipo: corpo.tipo === undefined ? cat.tipo : corpo.tipo }).returning();
    await auditar(db, req, "FIN_REGRA_CRIADA", { tipo: "fin_regra", id: r!.id }, { texto: r!.texto });
    return r;
  });

  app.patch("/api/financeiro/regras/:id", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = esquemaRegra.partial().parse(req.body);
    const atual = await garantirRegra(db, u, id);
    await validarRegra(db, u, {
      categoriaId: corpo.categoriaId ?? atual.categoriaId,
      tipo: corpo.tipo === undefined ? (atual.tipo as "RECEITA" | "DESPESA" | null) : corpo.tipo,
      unidadeId: corpo.unidadeId === undefined ? atual.unidadeId : corpo.unidadeId,
    });
    const [r] = await db.update(finRegras).set(corpo).where(eq(finRegras.id, id)).returning();
    await auditar(db, req, "FIN_REGRA_ALTERADA", { tipo: "fin_regra", id }, { campos: Object.keys(corpo) });
    return r;
  });

  app.delete("/api/financeiro/regras/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await garantirRegra(db, req.usuario!, id);
    const apagadas = await db.delete(finRegras).where(eq(finRegras.id, id)).returning({ id: finRegras.id });
    if (apagadas.length === 0) throw new ErroHttp(404, "NAO_ENCONTRADO", "Regra não encontrada.");
    await auditar(db, req, "FIN_REGRA_EXCLUIDA", { tipo: "fin_regra", id });
    return { ok: true };
  });

  // ------------------------------------------------------------------ lançamentos (a pagar e a receber)
  const camposComuns = {
    descricao: z.string().trim().min(2).max(200),
    contraparte: z.string().trim().max(150).nullish(),
    categoriaId: uuid,
    contaId: uuid.nullish(),
    unidadeId: uuid.nullish(),
    linha: z.enum(LINHAS_FINANCEIRO).nullish(),
    veiculo: veiculoOpcional,
    canal: z.enum(CANAIS).nullish(),
    forma: z.enum(FORMAS_PAGAMENTO).nullish(),
    observacao: z.string().trim().max(1000).nullish(),
  };
  const esquemaNovo = z.object({
    ...camposComuns,
    tipo: z.enum(["PAGAR", "RECEBER"]),
    valorCentavos: valorPositivo,
    competencia: dataIso,
    vencimento: dataIso,
    repeticao: z.discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("PARCELADO"), parcelas: z.number().int().min(2).max(120) }),
      z.object({ tipo: z.literal("RECORRENTE"), meses: z.number().int().min(2).max(60) }),
    ]).nullish(),
    /** A tela confirma que quer lançar mesmo havendo um igual criado há pouco (ver POSSIVEL_DUPLICADO). */
    confirmarDuplicado: z.boolean().optional(),
  });

  const colunasLista = {
    id: finLancamentos.id, tipo: finLancamentos.tipo, descricao: finLancamentos.descricao, contraparte: finLancamentos.contraparte,
    categoriaId: finLancamentos.categoriaId, categoriaNome: finCategorias.nome, contaId: finLancamentos.contaId, contaNome: finContas.nome,
    unidadeId: finLancamentos.unidadeId, linha: finLancamentos.linha, veiculo: finLancamentos.veiculo, canal: finLancamentos.canal, forma: finLancamentos.forma,
    valorCentavos: finLancamentos.valorCentavos, competencia: finLancamentos.competencia, vencimento: finLancamentos.vencimento, situacao: finLancamentos.situacao,
    pagoEm: finLancamentos.pagoEm, valorPagoCentavos: finLancamentos.valorPagoCentavos, jurosCentavos: finLancamentos.jurosCentavos, multaCentavos: finLancamentos.multaCentavos,
    descontoCentavos: finLancamentos.descontoCentavos, grupoId: finLancamentos.grupoId, parcelaNumero: finLancamentos.parcelaNumero, parcelaTotal: finLancamentos.parcelaTotal,
    recorrente: finLancamentos.recorrente, observacao: finLancamentos.observacao, origem: finLancamentos.origem, conciliado: conciliadoSql,
  };
  const baseLista = () => db.select(colunasLista).from(finLancamentos)
    .innerJoin(finCategorias, eq(finCategorias.id, finLancamentos.categoriaId))
    .leftJoin(finContas, eq(finContas.id, finLancamentos.contaId));

  async function lancamentoCompleto(id: string) {
    const [l] = await baseLista().where(eq(finLancamentos.id, id));
    return l!;
  }
  async function lancamentosCompletos(ids: string[]) {
    return baseLista().where(inArray(finLancamentos.id, ids)).orderBy(asc(finLancamentos.vencimento), asc(finLancamentos.criadoEm), asc(finLancamentos.id));
  }

  app.get("/api/financeiro/lancamentos", ver, async (req) => {
    const u = req.usuario!;
    const q = z.object({
      tipo: z.enum(["PAGAR", "RECEBER"]).optional(),
      situacao: z.enum(["ABERTO", "REALIZADO", "VENCIDO"]).optional(),
      campo: z.enum(["vencimento", "competencia", "pagoEm"]).default("vencimento"),
      de: dataIso.optional(), ate: dataIso.optional(),
      unidadeId: uuid.optional(), contaId: uuid.optional(), categoriaId: uuid.optional(), linha: z.enum(LINHAS_FINANCEIRO).optional(),
      q: z.string().trim().max(100).optional(),
      /** Fornecedor/cliente (texto, parte do nome). */
      fornecedor: z.string().trim().max(100).optional(),
      /** Faixa de valor em centavos. */
      valorMin: z.coerce.number().int().min(0).optional(),
      valorMax: z.coerce.number().int().min(0).optional(),
      pagina: z.coerce.number().int().min(1).max(10_000).default(1),
      limite: z.coerce.number().int().min(1).max(500).default(200),
    }).parse(req.query);
    const hoje = hojeSP();
    const coluna = q.campo === "pagoEm" ? finLancamentos.pagoEm : q.campo === "competencia" ? finLancamentos.competencia : finLancamentos.vencimento;
    const busca = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const where = and(
      filtroPracaEscolhida(u, finLancamentos.unidadeId, q.unidadeId),
      q.tipo ? eq(finLancamentos.tipo, q.tipo) : undefined,
      q.situacao === "VENCIDO" ? and(eq(finLancamentos.situacao, "ABERTO"), lt(finLancamentos.vencimento, hoje)) : q.situacao ? eq(finLancamentos.situacao, q.situacao) : undefined,
      q.de ? gte(coluna, q.de) : undefined, q.ate ? lte(coluna, q.ate) : undefined,
      q.contaId ? eq(finLancamentos.contaId, q.contaId) : undefined,
      q.categoriaId ? eq(finLancamentos.categoriaId, q.categoriaId) : undefined,
      q.linha ? eq(finLancamentos.linha, q.linha) : undefined,
      busca ? or(ilike(finLancamentos.descricao, busca), ilike(finLancamentos.contraparte, busca)) : undefined,
      q.fornecedor ? ilike(finLancamentos.contraparte, `%${q.fornecedor.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
      q.valorMin !== undefined ? gte(finLancamentos.valorCentavos, q.valorMin) : undefined,
      q.valorMax !== undefined ? lte(finLancamentos.valorCentavos, q.valorMax) : undefined,
    );
    const itens = await baseLista().where(where).orderBy(asc(finLancamentos.vencimento), asc(finLancamentos.criadoEm), asc(finLancamentos.id)).limit(q.limite).offset((q.pagina - 1) * q.limite);
    const [tot] = await db.select({
      qtd: sql<number>`count(*)`.mapWith(Number),
      devido: sql<number>`coalesce(sum(${finLancamentos.valorCentavos}), 0)`.mapWith(Number),
      aberto: sql<number>`coalesce(sum(case when ${finLancamentos.situacao} = 'ABERTO' then ${finLancamentos.valorCentavos} else 0 end), 0)`.mapWith(Number),
      realizado: sql<number>`coalesce(sum(case when ${finLancamentos.situacao} = 'REALIZADO' then ${finLancamentos.valorPagoCentavos} else 0 end), 0)`.mapWith(Number),
      vencido: sql<number>`coalesce(sum(case when ${finLancamentos.situacao} = 'ABERTO' and ${finLancamentos.vencimento} < ${hoje} then ${finLancamentos.valorCentavos} else 0 end), 0)`.mapWith(Number),
      qtdVencido: sql<number>`count(*) filter (where ${finLancamentos.situacao} = 'ABERTO' and ${finLancamentos.vencimento} < ${hoje})`.mapWith(Number),
    }).from(finLancamentos).where(where);
    return {
      hoje, itens: itens.map((i) => ({ ...i, vencido: i.situacao === "ABERTO" && i.vencimento < hoje })), total: tot!.qtd,
      somaDevidoCentavos: tot!.devido, somaAbertoCentavos: tot!.aberto, somaRealizadoCentavos: tot!.realizado, somaVencidoCentavos: tot!.vencido, qtdVencido: tot!.qtdVencido,
    };
  });

  app.post("/api/financeiro/lancamentos", gerenciar, async (req) => {
    const u = req.usuario!;
    const { confirmarDuplicado, ...corpo } = esquemaNovo.parse(req.body);
    // Trava contra lançamento repetido (dono, 13/11/2026: salvamento lento fez a equipe digitar de novo e duplicou).
    // Igual = mesmo tipo, descrição, valor e vencimento, criado nas últimas 12 horas. A tela pergunta antes de lançar.
    if (!confirmarDuplicado) {
      const [igual] = await db.select({ criadoEm: finLancamentos.criadoEm, situacao: finLancamentos.situacao }).from(finLancamentos).where(and(
        eq(finLancamentos.tipo, corpo.tipo), eq(finLancamentos.valorCentavos, corpo.valorCentavos), eq(finLancamentos.vencimento, corpo.vencimento),
        sql`lower(trim(${finLancamentos.descricao})) = lower(trim(${corpo.descricao}))`,
        gte(finLancamentos.criadoEm, new Date(Date.now() - 12 * 3_600_000)),
      )).orderBy(desc(finLancamentos.criadoEm)).limit(1);
      if (igual) {
        const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(igual.criadoEm);
        throw new ErroHttp(409, "POSSIVEL_DUPLICADO", `Já existe um lançamento igual (mesma descrição, valor e vencimento) criado hoje às ${hora}${igual.situacao === "REALIZADO" ? ", já baixado" : ""}. Confira na lista antes de lançar de novo.`);
      }
    }
    await validarCategoria(db, corpo.categoriaId, corpo.tipo);
    const unidadeId = await validarPracaDoRegistro(db, u, corpo.unidadeId);
    if (corpo.contaId) await garantirConta(db, u, corpo.contaId);
    const rep = corpo.repeticao ?? null;
    let valores: number[];
    try {
      valores = rep?.tipo === "PARCELADO" ? parcelar(corpo.valorCentavos, rep.parcelas) : Array.from({ length: rep?.tipo === "RECORRENTE" ? rep.meses : 1 }, () => corpo.valorCentavos);
    } catch (e) {
      throw new ErroHttp(400, "PARCELAS_INVALIDAS", (e as Error).message);
    }
    const grupoId = rep ? randomUUID() : null;
    const total = valores.length;
    const { repeticao: _r, ...base } = corpo;
    const ids = await db.transaction(async (tx) => {
      const linhas = valores.map((v, i) => ({
        ...base, unidadeId, veiculo: base.veiculo || null,
        descricao: rep?.tipo === "PARCELADO" ? `${base.descricao} (${i + 1}/${total})` : base.descricao,
        valorCentavos: v,
        competencia: somarMeses(base.competencia, i), vencimento: somarMeses(base.vencimento, i),
        grupoId, parcelaNumero: rep?.tipo === "PARCELADO" ? i + 1 : null, parcelaTotal: rep?.tipo === "PARCELADO" ? total : null,
        recorrente: rep?.tipo === "RECORRENTE", criadoPor: u.id,
      }));
      return (await tx.insert(finLancamentos).values(linhas).returning({ id: finLancamentos.id })).map((r) => r.id);
    });
    await auditar(db, req, "FIN_LANCAMENTO_CRIADO", { tipo: "fin_lancamento", id: ids[0] }, { tipo: corpo.tipo, valorCentavos: corpo.valorCentavos, quantidade: ids.length, repeticao: rep?.tipo ?? null });
    return { ids, lancamentos: await lancamentosCompletos(ids) };
  });

  const esquemaEdicao = z.object({
    ...camposComuns,
    valorCentavos: valorPositivo,
    competencia: dataIso,
    vencimento: dataIso,
  }).partial();

  app.patch("/api/financeiro/lancamentos/:id", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = esquemaEdicao.parse(req.body);
    const atual = await garantirLancamento(db, u, id);
    const conciliado = await estaConciliado(db, id);
    const mudou = <T>(novo: T | undefined, antigo: T) => novo !== undefined && novo !== antigo;
    if (conciliado && (mudou(corpo.valorCentavos, atual.valorCentavos) || mudou(corpo.competencia, atual.competencia) || mudou(corpo.vencimento, atual.vencimento) || (corpo.contaId !== undefined && (corpo.contaId ?? null) !== atual.contaId))) {
      throw new ErroHttp(409, "LANCAMENTO_CONCILIADO", "Lançamento conciliado não pode ter valor, datas ou conta alterados. Desfaça a conciliação antes.");
    }
    if (atual.situacao === "REALIZADO" && mudou(corpo.valorCentavos, atual.valorCentavos)) {
      throw new ErroHttp(409, "LANCAMENTO_REALIZADO", "Lançamento já baixado: reabra a baixa antes de alterar o valor.");
    }
    if (corpo.categoriaId) await validarCategoria(db, corpo.categoriaId, atual.tipo as "PAGAR" | "RECEBER");
    if (corpo.unidadeId !== undefined && corpo.unidadeId !== atual.unidadeId) corpo.unidadeId = await validarPracaDoRegistro(db, u, corpo.unidadeId);
    if (corpo.contaId) await garantirConta(db, u, corpo.contaId);
    const { veiculo, ...resto } = corpo;
    await db.update(finLancamentos).set({ ...resto, ...(veiculo !== undefined ? { veiculo: veiculo || null } : {}), atualizadoEm: new Date() }).where(eq(finLancamentos.id, id));
    await auditar(db, req, "FIN_LANCAMENTO_ALTERADO", { tipo: "fin_lancamento", id }, { campos: Object.keys(corpo) });
    return lancamentoCompleto(id);
  });

  app.post("/api/financeiro/lancamentos/:id/baixa", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({
      pagoEm: dataIso, contaId: uuid.nullish(),
      jurosCentavos: naoNegativo.default(0), multaCentavos: naoNegativo.default(0), descontoCentavos: naoNegativo.default(0),
    }).parse(req.body);
    const atual = await garantirLancamento(db, u, id);
    if (atual.situacao !== "ABERTO") throw new ErroHttp(409, "JA_BAIXADO", "Este lançamento já foi baixado.");
    if (corpo.pagoEm > hojeSP()) throw new ErroHttp(400, "DATA_FUTURA", "A data da baixa não pode ser futura.");
    const contaId = corpo.contaId ?? atual.contaId;
    if (!contaId) throw new ErroHttp(400, "CONTA_OBRIGATORIA", "Informe a conta da baixa.");
    const conta = await garantirConta(db, u, contaId);
    if (!conta.ativa) throw new ErroHttp(400, "CONTA_INATIVA", "Esta conta está desativada.");
    await garantirCaixaAberto(db, contaId, corpo.pagoEm);
    let pago: number;
    try {
      pago = calcularBaixa({ valorCentavos: atual.valorCentavos, jurosCentavos: corpo.jurosCentavos, multaCentavos: corpo.multaCentavos, descontoCentavos: corpo.descontoCentavos });
    } catch (e) {
      throw new ErroHttp(400, "BAIXA_INVALIDA", (e as Error).message);
    }
    const r = await db.update(finLancamentos).set({
      situacao: "REALIZADO", pagoEm: corpo.pagoEm, contaId, valorPagoCentavos: pago,
      jurosCentavos: corpo.jurosCentavos, multaCentavos: corpo.multaCentavos, descontoCentavos: corpo.descontoCentavos, atualizadoEm: new Date(),
    }).where(and(eq(finLancamentos.id, id), eq(finLancamentos.situacao, "ABERTO"))).returning({ id: finLancamentos.id });
    if (r.length === 0) throw new ErroHttp(409, "JA_BAIXADO", "Este lançamento já foi baixado.");
    await auditar(db, req, "FIN_LANCAMENTO_BAIXADO", { tipo: "fin_lancamento", id }, { valorCentavos: atual.valorCentavos, valorPagoCentavos: pago, ...corpo });
    return lancamentoCompleto(id);
  });

  app.post("/api/financeiro/lancamentos/:id/reabrir", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = z.object({ id: uuid }).parse(req.params);
    const atual = await garantirLancamento(db, u, id);
    if (atual.situacao !== "REALIZADO") throw new ErroHttp(409, "NAO_BAIXADO", "Este lançamento não está baixado.");
    await garantirCaixaAberto(db, atual.contaId, atual.pagoEm);
    if (await estaConciliado(db, id)) throw new ErroHttp(409, "LANCAMENTO_CONCILIADO", "Lançamento conciliado não pode ser reaberto. Desfaça a conciliação antes.");
    await db.update(finLancamentos).set({ situacao: "ABERTO", pagoEm: null, valorPagoCentavos: null, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0, atualizadoEm: new Date() }).where(eq(finLancamentos.id, id));
    await auditar(db, req, "FIN_LANCAMENTO_REABERTO", { tipo: "fin_lancamento", id }, { valorPagoCentavos: atual.valorPagoCentavos });
    return lancamentoCompleto(id);
  });

  app.delete("/api/financeiro/lancamentos/:id", gerenciar, async (req) => {
    const u = req.usuario!;
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { serie } = z.object({ serie: z.enum(["1"]).optional() }).parse(req.query);
    const atual = await garantirLancamento(db, u, id);
    if (await estaConciliado(db, id)) throw new ErroHttp(409, "LANCAMENTO_CONCILIADO", "Lançamento conciliado não pode ser excluído. Desfaça a conciliação antes.");
    if (atual.situacao === "REALIZADO") throw new ErroHttp(409, "LANCAMENTO_REALIZADO", "Lançamento já baixado: reabra a baixa antes de excluir.");
    const alvo: SQL = serie && atual.grupoId
      ? and(eq(finLancamentos.grupoId, atual.grupoId), eq(finLancamentos.situacao, "ABERTO"), gte(finLancamentos.vencimento, atual.vencimento))!
      : eq(finLancamentos.id, id);
    const apagados = await db.delete(finLancamentos).where(and(alvo, naoConciliadoSql)).returning({ id: finLancamentos.id });
    await auditar(db, req, "FIN_LANCAMENTO_EXCLUIDO", { tipo: "fin_lancamento", id }, { quantidade: apagados.length, serie: !!serie, valorCentavos: atual.valorCentavos });
    return { excluidos: apagados.length };
  });

  // ------------------------------------------------------------------ resumo
  app.get("/api/financeiro/resumo", ver, async (req) => {
    const u = req.usuario!;
    const q = z.object({ mes: mesIso.optional(), unidadeId: uuid.optional(), ref: dataIso.optional() }).parse(req.query);
    const hoje = q.ref ?? hojeSP();
    const mes = q.mes ?? hoje.slice(0, 7);
    const inicioMes = `${mes}-01`;
    const fimMes = fimDoMes(mes);
    const escopo = filtroPracaEscolhida(u, finLancamentos.unidadeId, q.unidadeId);
    const colunasRel = {
      tipo: finLancamentos.tipo, situacao: finLancamentos.situacao, valorCentavos: finLancamentos.valorCentavos, valorPagoCentavos: finLancamentos.valorPagoCentavos,
      jurosCentavos: finLancamentos.jurosCentavos, multaCentavos: finLancamentos.multaCentavos, descontoCentavos: finLancamentos.descontoCentavos,
      vencimento: finLancamentos.vencimento, pagoEm: finLancamentos.pagoEm, categoriaId: finLancamentos.categoriaId, unidadeId: finLancamentos.unidadeId, linha: finLancamentos.linha,
    };

    // A pagar / a receber do mês (por vencimento) e vencidas.
    const doMes = await db.select({
      tipo: finLancamentos.tipo, situacao: finLancamentos.situacao,
      qtd: sql<number>`count(*)`.mapWith(Number),
      devido: sql<number>`coalesce(sum(${finLancamentos.valorCentavos}), 0)`.mapWith(Number),
      pago: sql<number>`coalesce(sum(${finLancamentos.valorPagoCentavos}), 0)`.mapWith(Number),
    }).from(finLancamentos).where(and(escopo, gte(finLancamentos.vencimento, inicioMes), lte(finLancamentos.vencimento, fimMes))).groupBy(finLancamentos.tipo, finLancamentos.situacao);
    const bloco = (tipo: string) => {
      const a = doMes.find((x) => x.tipo === tipo && x.situacao === "ABERTO");
      const r = doMes.find((x) => x.tipo === tipo && x.situacao === "REALIZADO");
      return { abertoCentavos: a?.devido ?? 0, abertoQtd: a?.qtd ?? 0, realizadoCentavos: r?.pago ?? 0, realizadoQtd: r?.qtd ?? 0 };
    };
    const vencidasLinhas = await db.select({
      tipo: finLancamentos.tipo, qtd: sql<number>`count(*)`.mapWith(Number), devido: sql<number>`coalesce(sum(${finLancamentos.valorCentavos}), 0)`.mapWith(Number),
    }).from(finLancamentos).where(and(escopo, eq(finLancamentos.situacao, "ABERTO"), lt(finLancamentos.vencimento, hoje))).groupBy(finLancamentos.tipo);
    const vencida = (tipo: string) => ({ qtd: vencidasLinhas.find((x) => x.tipo === tipo)?.qtd ?? 0, centavos: vencidasLinhas.find((x) => x.tipo === tipo)?.devido ?? 0 });

    // Saldos das contas (exceto cartões) e fluxo semanal.
    const contas = await db.select().from(finContas).where(and(filtroPracaEscolhida(u, finContas.unidadeId, q.unidadeId), eq(finContas.ativa, true))).orderBy(asc(finContas.tipo), asc(finContas.nome));
    const saldos = await saldosDasContas(db, contas);
    const saldoCaixa = contas.filter((c) => c.tipo !== "CARTAO").reduce((s, c) => s + (saldos.get(c.id) ?? 0), 0);
    const semanasAntes = 4;
    const semanasDepois = 8;
    const primeira = somarDiasIso(inicioDaSemana(hoje), -7 * semanasAntes);
    const ultima = somarDiasIso(inicioDaSemana(hoje), 7 * (semanasDepois + 1) - 1);
    // Compra no cartão não sai do caixa na compra: lançamentos de conta de cartão ficam fora do fluxo de caixa.
    const paraFluxo = await db.select(colunasRel).from(finLancamentos).leftJoin(finContas, eq(finContas.id, finLancamentos.contaId)).where(and(escopo, or(isNull(finLancamentos.contaId), ne(finContas.tipo, "CARTAO")), or(
      and(eq(finLancamentos.situacao, "REALIZADO"), gte(finLancamentos.pagoEm, primeira), lte(finLancamentos.pagoEm, ultima)),
      and(eq(finLancamentos.situacao, "ABERTO"), lte(finLancamentos.vencimento, ultima)),
    )));
    // O pagamento da fatura (transferência de uma conta para o cartão) é o que sai do caixa, na data em que foi pago.
    const parCartao = alias(finExtratoLinhas, "par_cartao");
    const contaPar = alias(finContas, "conta_par");
    const pagamentosFatura = await db.select({ data: finExtratoLinhas.data, valor: finExtratoLinhas.valorCentavos, unidadeId: finContas.unidadeId })
      .from(finExtratoLinhas).innerJoin(finContas, eq(finContas.id, finExtratoLinhas.contaId))
      .innerJoin(parCartao, eq(parCartao.id, finExtratoLinhas.parLinhaId)).innerJoin(contaPar, eq(contaPar.id, parCartao.contaId))
      .where(and(
        filtroPracaEscolhida(u, finContas.unidadeId, q.unidadeId), eq(finExtratoLinhas.status, "TRANSFERENCIA"), lt(finExtratoLinhas.valorCentavos, 0),
        ne(finContas.tipo, "CARTAO"), eq(contaPar.tipo, "CARTAO"), gte(finExtratoLinhas.data, primeira), lte(finExtratoLinhas.data, ultima),
      ));
    const comoLancamentos: LancamentoRelatorio[] = [
      ...(paraFluxo as LancamentoRelatorio[]),
      ...pagamentosFatura.map((p) => ({
        tipo: "PAGAR" as const, situacao: "REALIZADO" as const, valorCentavos: -p.valor, valorPagoCentavos: -p.valor, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0,
        vencimento: p.data, pagoEm: p.data, categoriaId: "", unidadeId: p.unidadeId, linha: null,
      })),
    ];
    const fluxo = montarFluxoSemanal({ hoje, semanasAntes, semanasDepois, lancamentos: comoLancamentos, saldoAtualCentavos: saldoCaixa });

    // DRE gerencial do mês (competência).
    await garantirPlano(db);
    const cats = await db.select().from(finCategorias);
    const mapaCats = new Map<string, CategoriaInfo>(cats.map((c) => [c.id, { nome: c.nome, tipo: c.tipo as CategoriaInfo["tipo"], grupo: c.grupo, ordem: c.ordem }]));
    const paraDre = await db.select(colunasRel).from(finLancamentos).where(and(escopo, gte(finLancamentos.competencia, inicioMes), lte(finLancamentos.competencia, fimMes)));
    const dre = montarDre(paraDre as LancamentoRelatorio[], mapaCats);
    // Receita realizada por conta (como "RECEITA SIC / RECEITA UNI" no topo da planilha de controle).
    const receitaPorConta = (await db.select({ contaId: finLancamentos.contaId, nome: finContas.nome, total: sql<number>`coalesce(sum(${finLancamentos.valorPagoCentavos}), 0)`.mapWith(Number) })
      .from(finLancamentos).leftJoin(finContas, eq(finContas.id, finLancamentos.contaId))
      .where(and(escopo, eq(finLancamentos.tipo, "RECEBER"), eq(finLancamentos.situacao, "REALIZADO"), gte(finLancamentos.competencia, inicioMes), lte(finLancamentos.competencia, fimMes)))
      .groupBy(finLancamentos.contaId, finContas.nome).orderBy(asc(finContas.nome)))
      .map((r) => ({ contaId: r.contaId, nome: r.nome ?? "Sem conta", totalCentavos: r.total }));

    const contasVisiveis = contas.map((c) => c.id);
    const [pend] = contasVisiveis.length
      ? await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(finExtratoLinhas).where(and(inArray(finExtratoLinhas.contaId, contasVisiveis), eq(finExtratoLinhas.status, "PENDENTE")))
      : [{ n: 0 }];

    return {
      hoje, mes,
      aPagar: bloco("PAGAR"), aReceber: bloco("RECEBER"),
      vencidas: { pagar: vencida("PAGAR"), receber: vencida("RECEBER") },
      saldos: contas.map((c) => ({ contaId: c.id, nome: c.nome, tipo: c.tipo, saldoCentavos: saldos.get(c.id) ?? 0 })),
      saldoCaixaCentavos: saldoCaixa,
      fluxo, dre, receitaPorConta,
      linhasPendentes: pend?.n ?? 0,
    };
  });

  // ------------------------------------------------------------------ DRE gerencial (aba DRE, 10/11/2026)
  app.get("/api/financeiro/dre", ver, async (req) => {
    const u = req.usuario!;
    const q = z.object({
      ano: z.coerce.number().int().min(2000).max(2100).optional(),
      regime: z.enum(["COMPETENCIA", "CAIXA"]).default("COMPETENCIA"),
      unidadeId: uuid.optional(),
      linha: z.enum(LINHAS_FINANCEIRO).optional(),
    }).parse(req.query);
    const ano = q.ano ?? Number(hojeSP().slice(0, 4));
    const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
    const coluna = q.regime === "CAIXA" ? finLancamentos.pagoEm : finLancamentos.competencia;
    await garantirPlano(db);
    const cats = await db.select().from(finCategorias);
    const mapaCats = new Map<string, CategoriaInfo>(cats.map((c) => [c.id, { nome: c.nome, tipo: c.tipo as CategoriaInfo["tipo"], grupo: c.grupo, ordem: c.ordem }]));
    const lancs = await db.select({
      tipo: finLancamentos.tipo, situacao: finLancamentos.situacao, valorCentavos: finLancamentos.valorCentavos, valorPagoCentavos: finLancamentos.valorPagoCentavos,
      jurosCentavos: finLancamentos.jurosCentavos, multaCentavos: finLancamentos.multaCentavos, descontoCentavos: finLancamentos.descontoCentavos,
      vencimento: finLancamentos.vencimento, pagoEm: finLancamentos.pagoEm, competencia: finLancamentos.competencia,
      categoriaId: finLancamentos.categoriaId, unidadeId: finLancamentos.unidadeId, linha: finLancamentos.linha,
    }).from(finLancamentos).where(and(
      filtroPracaEscolhida(u, finLancamentos.unidadeId, q.unidadeId),
      q.linha ? eq(finLancamentos.linha, q.linha) : undefined,
      gte(coluna, `${ano}-01-01`), lte(coluna, `${ano}-12-31`),
    ));
    return montarDreGerencial(lancs as LancamentoDre[], mapaCats, meses, q.regime);
  });

  // ------------------------------------------------------------------ cartões: faturas por ciclo
  app.get("/api/financeiro/cartoes", ver, async (req) => {
    const u = req.usuario!;
    const cartoes = await db.select().from(finContas).where(and(filtroPraca(u, finContas.unidadeId), eq(finContas.tipo, "CARTAO"))).orderBy(asc(finContas.nome));
    const saldos = await saldosDasContas(db, cartoes);
    const hoje = hojeSP();
    const saida = [];
    const todasLinhas = cartoes.length
      ? await db.select({ contaId: finExtratoLinhas.contaId, data: finExtratoLinhas.data, valor: finExtratoLinhas.valorCentavos, status: finExtratoLinhas.status })
        .from(finExtratoLinhas).where(and(inArray(finExtratoLinhas.contaId, cartoes.map((c) => c.id)), gte(finExtratoLinhas.data, somarMeses(hoje, -14)))).orderBy(desc(finExtratoLinhas.data))
      : [];
    for (const c of cartoes) {
      const linhas = todasLinhas.filter((l) => l.contaId === c.id);
      const faturas = new Map<string, { referencia: string; fechamento: string; vencimento: string; totalCentavos: number; linhas: number; pendentes: number }>();
      if (c.diaFechamento && c.diaVencimento) {
        for (const l of linhas) {
          if (l.status === "TRANSFERENCIA") continue; // pagamento da fatura não é compra
          const f = faturaDaData(l.data, c.diaFechamento, c.diaVencimento);
          const x = faturas.get(f.referencia) ?? { ...f, totalCentavos: 0, linhas: 0, pendentes: 0 };
          x.totalCentavos += -l.valor;
          x.linhas += 1;
          if (l.status === "PENDENTE") x.pendentes += 1;
          faturas.set(f.referencia, x);
        }
      }
      saida.push({
        ...c, saldoCentavos: saldos.get(c.id) ?? 0,
        faturas: [...faturas.values()].sort((a, b) => b.referencia.localeCompare(a.referencia)).map((f) => ({ ...f, situacao: hoje <= f.fechamento ? "ABERTA" : hoje <= f.vencimento ? "FECHADA" : "ENCERRADA" })),
      });
    }
    return saida;
  });

  await rotasFinanceiroExtrato(app, ctx, { ver, gerenciar });
  await rotasFinanceiroPlanilha(app, ctx, { ver, gerenciar });
  await rotasFinanceiroCaixa(app, ctx, { ver, gerenciar });
}
