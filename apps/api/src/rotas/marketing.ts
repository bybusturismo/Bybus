import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  codigoAfiliadoValido, indicadoresCampanha, linkAfiliado, MIDIAS_CAMPANHA, MODELO_AVALIACAO_PADRAO, normalizarCodigoAfiliado,
  percentuais, REDES_CONTEUDO, STATUS_CONTEUDO, TIPOS_AFILIADO,
} from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import {
  afiliados, campanhaResultados, campanhas, conteudos, marketingConfig,
  passageiros, passeios, perfis, pessoas, reservas, saidas, usuarios,
} from "../db/schema.js";
import { filtroUnidade, podeUnidade } from "../seguranca/escopo.js";
import { atribuicaoDeVendas, custosDasCampanhas } from "../servicos/atribuicao.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";

const uuid = z.string().uuid();
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD").refine((d) => {
  const x = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
}, "Data inválida");
const mesIso = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês no formato AAAA-MM");
const texto = (max: number) => z.string().trim().max(max);
const textoOpc = (max: number) => texto(max).nullish().transform((v) => (v ? v : null));
const urlHttps = z.string().trim().max(500).url().refine((u) => u.startsWith("https://"), "Use um endereço https://");

const URL_LOJA_PADRAO = "https://loja.bybusturismo.com.br";

function hoje(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function dataBr(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

const periodo = z.object({ de: dataIso.optional(), ate: dataIso.optional(), unidadeId: uuid.optional() }).transform((q) => {
  // Padrão: 90 dias para trás e 60 para a frente (reserva de passeio futuro também é venda).
  const ate = q.ate ?? somarDias(hoje(), 60);
  return { de: q.de ?? somarDias(hoje(), -89), ate, unidadeId: q.unidadeId };
}).refine((p) => p.de <= p.ate, "A data inicial deve ser anterior à final.").refine((p) => (Date.parse(p.ate) - Date.parse(p.de)) / 86400_000 <= 800, "Período longo demais (máximo de 800 dias).");

/** Itens "de todas as praças" (unidade nula) são vistos por todos; os de uma praça só por quem tem acesso a ela. */
function visivel(u: UsuarioSessao, coluna: AnyPgColumn): SQL | undefined {
  const escopo = filtroUnidade(u, coluna as never);
  return escopo ? or(isNull(coluna), escopo) : undefined;
}
/** Quem pode alterar: item de uma praça → quem tem a praça; item de todas as praças → só quem enxerga todas. */
function podeAlterar(u: UsuarioSessao, unidadeId: string | null | undefined): boolean {
  return unidadeId ? podeUnidade(u, unidadeId) : u.todasUnidades;
}
function exigirAlterar(u: UsuarioSessao, unidadeId: string | null | undefined) {
  if (!podeAlterar(u, unidadeId)) throw new ErroHttp(403, "SEM_PERMISSAO", unidadeId ? "Você só pode alterar itens das suas praças." : "Só quem enxerga todas as praças altera itens de todas as praças.");
}
const naoEncontrado = (o: string) => new ErroHttp(404, "NAO_ENCONTRADO", `${o} não encontrado(a).`);

export async function rotasMarketing(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "marketing:ver") };
  const gerenciar = { preHandler: exigir(config, "marketing:gerenciar") };

  /** Reservas confirmadas de saídas do período, dentro das praças do usuário. */
  function condicoesVendas(u: UsuarioSessao, p: { de: string; ate: string; unidadeId?: string }) {
    if (p.unidadeId && !podeUnidade(u, p.unidadeId)) throw naoEncontrado("Praça");
    const c: Array<SQL | undefined> = [eq(reservas.status, "CONFIRMADA"), gte(saidas.data, p.de), lte(saidas.data, p.ate), filtroUnidade(u)];
    if (p.unidadeId) c.push(eq(passeios.unidadeId, p.unidadeId));
    return and(...c);
  }
  const reservasN = sql<number>`count(distinct ${reservas.id})::int`;
  const passageirosN = sql<number>`count(${passageiros.id})::int`;
  const baseVendas = () => db.select({ reservas: reservasN, passageiros: passageirosN }).from(reservas)
    .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
    .leftJoin(passageiros, eq(passageiros.reservaId, reservas.id));

  // ───────────── Painéis (só agregados) ─────────────

  /** Vendas por canal real (origem quando a reserva é espelho) e por passeio/mês. */
  app.get("/api/marketing/painel/canais", ver, async (req) => {
    const p = periodo.parse(req.query);
    const onde = condicoesVendas(req.usuario!, p);
    const canalExpr = sql<string>`coalesce(${reservas.canalOrigem}, ${reservas.canal})::text`;
    const mesExpr = sql<string>`to_char(${saidas.data}, 'YYYY-MM')`;
    const [porCanal, porPasseioMes, [total]] = await Promise.all([
      db.select({ canal: canalExpr, reservas: reservasN, passageiros: passageirosN }).from(reservas)
        .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
        .leftJoin(passageiros, eq(passageiros.reservaId, reservas.id)).where(onde).groupBy(canalExpr).orderBy(desc(passageirosN)),
      db.select({ mes: mesExpr, passeioId: passeios.id, passeio: passeios.nome, reservas: reservasN, passageiros: passageirosN }).from(reservas)
        .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
        .leftJoin(passageiros, eq(passageiros.reservaId, reservas.id)).where(onde).groupBy(mesExpr, passeios.id, passeios.nome).orderBy(asc(mesExpr), asc(passeios.nome)),
      baseVendas().where(onde),
    ]);
    const pct = percentuais(porCanal.map((c) => c.passageiros));
    return {
      periodo: { de: p.de, ate: p.ate },
      total: total ?? { reservas: 0, passageiros: 0 },
      porCanal: porCanal.map((c, i) => ({ ...c, percentual: pct[i] })),
      porPasseioMes,
    };
  });

  /** Ranking da origem dos clientes (UF ou país, como digitado/importado). */
  app.get("/api/marketing/painel/origem", ver, async (req) => {
    const p = periodo.parse(req.query);
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    const onde = condicoesVendas(req.usuario!, p);
    const origemExpr = sql<string>`upper(trim(coalesce(${reservas.origemCliente}, '')))`;
    const linhas = await db.select({ origem: origemExpr, reservas: reservasN, passageiros: passageirosN }).from(reservas)
      .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .leftJoin(passageiros, eq(passageiros.reservaId, reservas.id)).where(onde).groupBy(origemExpr).orderBy(desc(passageirosN), asc(origemExpr));
    const informadas = linhas.filter((l) => l.origem !== "");
    const sem = linhas.find((l) => l.origem === "");
    const totalInformado = informadas.reduce((s, l) => s + l.passageiros, 0);
    const ranking = informadas.slice(0, limite).map((l) => ({ ...l, percentual: totalInformado ? Math.round((l.passageiros / totalInformado) * 1000) / 10 : 0 }));
    return {
      periodo: { de: p.de, ate: p.ate },
      ranking,
      outras: informadas.slice(limite).reduce((s, l) => s + l.passageiros, 0),
      semInformacao: sem ?? { origem: "", reservas: 0, passageiros: 0 },
      totalInformado,
    };
  });

  // ───────────── Campanhas e cupons ─────────────

  const esquemaCampanha = z.object({
    unidadeId: uuid.nullish().transform((v) => v ?? null),
    nome: texto(120).min(2),
    midia: z.enum(MIDIAS_CAMPANHA),
    inicio: dataIso,
    fim: dataIso.nullish().transform((v) => v ?? null),
    investimentoCentavos: z.number().int().min(0).max(100_000_000_00),
    cupom: textoOpc(40),
    utmCampanha: textoOpc(80),
    metaReservas: z.number().int().min(1).max(1_000_000).nullish().transform((v) => v ?? null),
    observacoes: textoOpc(1000),
    ativa: z.boolean().default(true),
  }).refine((c) => !c.fim || c.fim >= c.inicio, "O fim deve ser igual ou posterior ao início.");

  async function listarCampanhas(u: UsuarioSessao, extra?: SQL) {
    const lista = await db.select().from(campanhas).where(and(visivel(u, campanhas.unidadeId), extra)).orderBy(desc(campanhas.inicio), asc(campanhas.nome));
    const resultados = lista.length ? await db.select().from(campanhaResultados).where(inArray(campanhaResultados.campanhaId, lista.map((c) => c.id))).orderBy(asc(campanhaResultados.mes)) : [];
    // Marketing 2: com venda atribuída automaticamente (UTM/cupom da Paytour) ela substitui o retorno digitado; custo importado por CSV substitui o investimento.
    const auto = await atribuicaoDeVendas(db, u, lista);
    const custos = await custosDasCampanhas(db, lista.map((c) => c.id));
    return lista.map((c) => {
      const rs = resultados.filter((r) => r.campanhaId === c.id);
      const a = auto.porCampanha.get(c.id);
      const usaAuto = !!a && a.reservas > 0;
      const custo = custos.get(c.id);
      const investimento = custo ? custo.custoCentavos : c.investimentoCentavos;
      const efetivos = usaAuto ? [{ reservas: a!.reservas, passageiros: a!.passageiros, receitaCentavos: a!.receitaCentavos }] : rs;
      return {
        ...c, criadoPor: undefined,
        resultados: rs.map((r) => ({ id: r.id, mes: r.mes, reservas: r.reservas, passageiros: r.passageiros, receitaCentavos: r.receitaCentavos, fonte: r.fonte })),
        totais: { reservas: efetivos.reduce((s, r) => s + r.reservas, 0), passageiros: efetivos.reduce((s, r) => s + r.passageiros, 0), receitaCentavos: efetivos.some((r) => r.receitaCentavos != null) ? efetivos.reduce((s, r) => s + (r.receitaCentavos ?? 0), 0) : null },
        indicadores: indicadoresCampanha({ investimentoCentavos: investimento, metaReservas: c.metaReservas, resultados: efetivos }),
        atribuicao: { tipo: usaAuto ? "AUTOMATICA" : rs.length ? "MANUAL" : "NENHUMA", pedidos: a?.vendas ?? 0, porUtm: a?.porUtm ?? 0, porCupom: a?.porCupom ?? 0 },
        investimentoEfetivoCentavos: investimento,
        custoImportado: custo ? { dias: custo.dias, custoCentavos: custo.custoCentavos, cliques: custo.cliques, impressoes: custo.impressoes } : null,
      };
    });
  }

  app.get("/api/marketing/campanhas", ver, async (req) => {
    const q = z.object({ ativas: z.enum(["0", "1"]).optional() }).parse(req.query);
    const campanhasLista = await listarCampanhas(req.usuario!, q.ativas === "1" ? eq(campanhas.ativa, true) : undefined);
    return {
      /** Atribuição automática por UTM/cupom da Paytour quando há pedido casado; senão vale o lançamento manual. */
      atribuicao: { situacao: "AUTOMATICA_QUANDO_HA_VENDA", nota: "Vendas com UTM ou cupom da campanha são atribuídas automaticamente (Paytour); sem elas, vale o resultado lançado à mão." },
      campanhas: campanhasLista,
      totais: {
        investimentoCentavos: campanhasLista.reduce((s, c) => s + c.investimentoCentavos, 0),
        reservasAtribuidas: campanhasLista.reduce((s, c) => s + c.totais.reservas, 0),
      },
    };
  });

  app.post("/api/marketing/campanhas", gerenciar, async (req) => {
    const c = esquemaCampanha.parse(req.body);
    exigirAlterar(req.usuario!, c.unidadeId);
    const [nova] = await db.insert(campanhas).values({ ...c, criadoPor: req.usuario!.id }).returning();
    await auditar(db, req, "CAMPANHA_CRIADA", { tipo: "campanha", id: nova!.id }, { nome: c.nome, midia: c.midia, investimentoCentavos: c.investimentoCentavos });
    return nova;
  });

  async function carregarCampanha(u: UsuarioSessao, id: string) {
    const [c] = await db.select().from(campanhas).where(and(eq(campanhas.id, id), visivel(u, campanhas.unidadeId)));
    if (!c) throw naoEncontrado("Campanha");
    exigirAlterar(u, c.unidadeId);
    return c;
  }

  app.patch("/api/marketing/campanhas/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const atual = await carregarCampanha(req.usuario!, id);
    const dados = esquemaCampanha.innerType().partial().parse(req.body);
    if (dados.unidadeId !== undefined) exigirAlterar(req.usuario!, dados.unidadeId);
    const inicio = dados.inicio ?? atual.inicio;
    const fim = dados.fim === undefined ? atual.fim : dados.fim;
    if (fim && fim < inicio) throw new ErroHttp(400, "PERIODO_INVALIDO", "O fim deve ser igual ou posterior ao início.");
    const [nova] = await db.update(campanhas).set({ ...dados, atualizadoEm: new Date() }).where(eq(campanhas.id, id)).returning();
    await auditar(db, req, "CAMPANHA_EDITADA", { tipo: "campanha", id }, { campos: Object.keys(dados) });
    return nova;
  });

  app.delete("/api/marketing/campanhas/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = await carregarCampanha(req.usuario!, id);
    await db.delete(campanhas).where(eq(campanhas.id, id));
    await auditar(db, req, "CAMPANHA_EXCLUIDA", { tipo: "campanha", id }, { nome: c.nome });
    return { ok: true };
  });

  /** Lançamento do resultado atribuído por mês (um por mês; reenviar o mês substitui o valor). */
  app.post("/api/marketing/campanhas/:id/resultados", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await carregarCampanha(req.usuario!, id);
    const r = z.object({
      mes: mesIso,
      reservas: z.number().int().min(0).max(1_000_000),
      passageiros: z.number().int().min(0).max(1_000_000),
      receitaCentavos: z.number().int().min(0).max(100_000_000_00).nullish().transform((v) => v ?? null),
      fonte: texto(120).min(2).default("MANUAL"),
    }).refine((x) => x.passageiros >= x.reservas || x.reservas === 0, "Passageiros não pode ser menor que reservas.").parse(req.body);
    const [salvo] = await db.insert(campanhaResultados).values({ ...r, campanhaId: id, criadoPor: req.usuario!.id })
      .onConflictDoUpdate({ target: [campanhaResultados.campanhaId, campanhaResultados.mes], set: { reservas: r.reservas, passageiros: r.passageiros, receitaCentavos: r.receitaCentavos, fonte: r.fonte } }).returning();
    await auditar(db, req, "CAMPANHA_RESULTADO_LANCADO", { tipo: "campanha", id }, { mes: r.mes, reservas: r.reservas, fonte: r.fonte });
    return salvo;
  });

  app.delete("/api/marketing/campanhas/:id/resultados/:mes", gerenciar, async (req) => {
    const { id, mes } = z.object({ id: uuid, mes: mesIso }).parse(req.params);
    await carregarCampanha(req.usuario!, id);
    await db.delete(campanhaResultados).where(and(eq(campanhaResultados.campanhaId, id), eq(campanhaResultados.mes, mes)));
    await auditar(db, req, "CAMPANHA_RESULTADO_REMOVIDO", { tipo: "campanha", id }, { mes });
    return { ok: true };
  });

  // ───────────── Calendário de conteúdo ─────────────

  const esquemaConteudo = z.object({
    unidadeId: uuid.nullish().transform((v) => v ?? null),
    titulo: texto(160).min(2),
    rede: z.enum(REDES_CONTEUDO),
    status: z.enum(STATUS_CONTEUDO).default("IDEIA"),
    dataPrevista: dataIso.nullish().transform((v) => v ?? null),
    legenda: textoOpc(2200),
    link: urlHttps.nullish().transform((v) => v ?? null),
    responsavelId: uuid.nullish().transform((v) => v ?? null),
  });

  /**
   * Aprovação (ver rotas/conteudo-publicacao.ts): APROVADO só pelo botão Aprovar; no Instagram, AGENDADO e PUBLICADO só pelo agendamento
   * e pela rotina de publicação. Nas outras redes (sem automação) a situação continua manual.
   */
  function guardarStatus(novo: string | undefined, rede: string) {
    if (novo === "APROVADO") throw new ErroHttp(400, "USE_APROVAR", "Para aprovar, use o botão Aprovar.");
    if (rede === "INSTAGRAM" && (novo === "AGENDADO" || novo === "PUBLICADO")) throw new ErroHttp(400, "USE_AGENDAR", "Posts do Instagram são agendados pelo botão Agendar e publicados pelo sistema.");
  }

  async function validarResponsavel(id: string | null | undefined) {
    if (!id) return;
    const [u] = await db.select({ ativo: usuarios.ativo }).from(usuarios).where(eq(usuarios.id, id));
    if (!u?.ativo) throw new ErroHttp(400, "RESPONSAVEL_INVALIDO", "Responsável inexistente ou inativo.");
  }

  /** Colegas que podem ser responsáveis por um conteúdo: usuários ativos que gerenciam o marketing (e administradores). */
  app.get("/api/marketing/responsaveis", ver, async () =>
    db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).innerJoin(perfis, eq(perfis.id, usuarios.perfilId))
      .where(and(eq(usuarios.ativo, true), or(eq(perfis.codigo, "ADMIN"), sql`'marketing:gerenciar' = any(${perfis.permissoes})`))).orderBy(asc(usuarios.nome)));

  app.get("/api/marketing/conteudos", ver, async (req) => {
    const q = z.object({ de: dataIso.optional(), ate: dataIso.optional(), status: z.enum(STATUS_CONTEUDO).optional(), rede: z.enum(REDES_CONTEUDO).optional() }).parse(req.query);
    const filtros = [visivel(req.usuario!, conteudos.unidadeId), q.de ? gte(conteudos.dataPrevista, q.de) : undefined, q.ate ? lte(conteudos.dataPrevista, q.ate) : undefined, q.status ? eq(conteudos.status, q.status) : undefined, q.rede ? eq(conteudos.rede, q.rede) : undefined];
    const lista = await db.select({ c: conteudos, responsavel: usuarios.nome, qtdMidias: sql<number>`(select count(*)::int from conteudo_midias m where m.conteudo_id = ${conteudos.id})` }).from(conteudos).leftJoin(usuarios, eq(usuarios.id, conteudos.responsavelId))
      .where(and(...filtros)).orderBy(sql`${conteudos.dataPrevista} asc nulls last`, asc(conteudos.titulo)).limit(500);
    return lista.map(({ c: { pubContainerId: _c, ...c }, responsavel, qtdMidias }) => ({ ...c, responsavel, qtdMidias }));
  });

  app.post("/api/marketing/conteudos", gerenciar, async (req) => {
    const c = esquemaConteudo.parse(req.body);
    guardarStatus(c.status, c.rede);
    exigirAlterar(req.usuario!, c.unidadeId);
    await validarResponsavel(c.responsavelId);
    const [novo] = await db.insert(conteudos).values(c).returning();
    await auditar(db, req, "CONTEUDO_CRIADO", { tipo: "conteudo", id: novo!.id }, { titulo: c.titulo, rede: c.rede, status: c.status });
    return novo;
  });

  async function carregarConteudo(u: UsuarioSessao, id: string) {
    const [c] = await db.select().from(conteudos).where(and(eq(conteudos.id, id), visivel(u, conteudos.unidadeId)));
    if (!c) throw naoEncontrado("Conteúdo");
    exigirAlterar(u, c.unidadeId);
    return c;
  }

  app.patch("/api/marketing/conteudos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const atual = await carregarConteudo(req.usuario!, id);
    const dados = esquemaConteudo.partial().parse(req.body);
    if (dados.unidadeId !== undefined) exigirAlterar(req.usuario!, dados.unidadeId);
    await validarResponsavel(dados.responsavelId);
    if (dados.status !== undefined && dados.status !== atual.status) guardarStatus(dados.status, dados.rede ?? atual.rede);
    // Aprovado/agendado perde a aprovação (e sai da fila) se o texto ou a rede mudarem, ou se voltar para uma situação anterior.
    const voltou = dados.status !== undefined && ["IDEIA", "PRODUCAO", "EM_APROVACAO"].includes(dados.status);
    const mudouConteudo = (dados.legenda !== undefined && dados.legenda !== atual.legenda) || (dados.rede !== undefined && dados.rede !== atual.rede);
    const perdeAprovacao = (atual.status === "APROVADO" || (atual.status === "AGENDADO" && atual.pubStatus === "AGENDADO")) && (voltou || mudouConteudo);
    const [novo] = await db.update(conteudos).set({
      ...dados, atualizadoEm: new Date(),
      ...(perdeAprovacao ? { status: voltou ? dados.status! : "EM_APROVACAO", aprovadoEm: null, aprovadoPor: null, pubStatus: null, pubErro: null, pubContainerId: null } : {}),
    }).where(and(eq(conteudos.id, id), sql`${conteudos.pubStatus} is distinct from 'PUBLICANDO'`)).returning();
    if (!novo) throw new ErroHttp(409, "PUBLICANDO", "Este post está sendo publicado agora. Tente de novo em instantes.");
    await auditar(db, req, "CONTEUDO_EDITADO", { tipo: "conteudo", id }, { campos: Object.keys(dados), de: atual.status, para: novo!.status });
    return novo;
  });

  app.delete("/api/marketing/conteudos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = await carregarConteudo(req.usuario!, id);
    await db.delete(conteudos).where(eq(conteudos.id, id));
    await auditar(db, req, "CONTEUDO_EXCLUIDO", { tipo: "conteudo", id }, { titulo: c.titulo });
    return { ok: true };
  });

  // ───────────── Configurações (modelo de avaliação, Tripadvisor, loja) ─────────────

  async function lerConfig() {
    const linhas = await db.select().from(marketingConfig);
    const v = (k: string) => linhas.find((l) => l.chave === k)?.valor ?? null;
    return { modeloAvaliacao: v("modelo_avaliacao") ?? MODELO_AVALIACAO_PADRAO, linkTripadvisor: v("link_tripadvisor"), urlLoja: v("url_loja") ?? URL_LOJA_PADRAO };
  }

  app.get("/api/marketing/config", ver, async () => ({
    ...(await lerConfig()),
    envioWhatsapp: { ligado: false, nota: "Envio por WhatsApp ainda não ligado (provedor a contratar). Por enquanto, copie o texto." },
  }));

  app.patch("/api/marketing/config", gerenciar, async (req) => {
    const c = z.object({
      modeloAvaliacao: texto(1000).min(10).optional(),
      linkTripadvisor: urlHttps.nullish(),
      urlLoja: urlHttps.optional(),
    }).parse(req.body);
    const gravar = async (chave: string, valor: string | null) => {
      if (valor === null) await db.delete(marketingConfig).where(eq(marketingConfig.chave, chave));
      else await db.insert(marketingConfig).values({ chave, valor, atualizadoPor: req.usuario!.id }).onConflictDoUpdate({ target: marketingConfig.chave, set: { valor, atualizadoEm: new Date(), atualizadoPor: req.usuario!.id } });
    };
    if (c.modeloAvaliacao !== undefined) await gravar("modelo_avaliacao", c.modeloAvaliacao);
    if (c.linkTripadvisor !== undefined) await gravar("link_tripadvisor", c.linkTripadvisor);
    if (c.urlLoja !== undefined) await gravar("url_loja", c.urlLoja);
    await auditar(db, req, "MARKETING_CONFIG_EDITADA", { tipo: "marketing_config" }, { campos: Object.keys(c) });
    return lerConfig();
  });

  // Avaliações (fila, painel, notas) e o resto do marketing 2: ver rotas/avaliacoes.ts e rotas/marketing-extras.ts.

  // ───────────── Afiliados próprios ─────────────

  const esquemaAfiliado = z.object({
    unidadeId: uuid.nullish().transform((v) => v ?? null),
    nome: texto(120).min(2),
    tipo: z.enum(TIPOS_AFILIADO).default("HOTEL"),
    codigo: z.string().trim().transform(normalizarCodigoAfiliado).refine(codigoAfiliadoValido, "Código com 3 a 24 caracteres: letras, números e hífen."),
    comissaoPontosBase: z.number().int().min(0).max(10_000).nullish().transform((v) => v ?? null),
    contato: textoOpc(200),
    paytourAfiliadoId: textoOpc(60),
    observacoes: textoOpc(1000),
    ativo: z.boolean().default(true),
  });

  app.get("/api/marketing/afiliados", ver, async (req) => {
    const cfg = await lerConfig();
    const lista = await db.select().from(afiliados).where(visivel(req.usuario!, afiliados.unidadeId)).orderBy(desc(afiliados.ativo), asc(afiliados.nome));
    return {
      urlLoja: cfg.urlLoja,
      ligacaoPaytour: { situacao: "PENDENTE", nota: "Ligação com os afiliados da Paytour pendente: confirmar se o link com ?ref= atribui a venda e como casar o código com o afiliado da Paytour." },
      afiliados: lista.map((a) => ({ ...a, link: linkAfiliado(cfg.urlLoja, a.codigo) })),
    };
  });

  async function carregarAfiliado(u: UsuarioSessao, id: string) {
    const [a] = await db.select().from(afiliados).where(and(eq(afiliados.id, id), visivel(u, afiliados.unidadeId)));
    if (!a) throw naoEncontrado("Afiliado");
    exigirAlterar(u, a.unidadeId);
    return a;
  }
  async function garantirCodigoLivre(codigo: string, exceto?: string) {
    const [x] = await db.select({ id: afiliados.id }).from(afiliados).where(eq(afiliados.codigo, codigo));
    if (x && x.id !== exceto) throw new ErroHttp(409, "CODIGO_EM_USO", "Já existe um afiliado com este código.");
  }

  app.post("/api/marketing/afiliados", gerenciar, async (req) => {
    const a = esquemaAfiliado.parse(req.body);
    exigirAlterar(req.usuario!, a.unidadeId);
    await garantirCodigoLivre(a.codigo);
    const [novo] = await db.insert(afiliados).values(a).returning();
    await auditar(db, req, "AFILIADO_CRIADO", { tipo: "afiliado", id: novo!.id }, { nome: a.nome, codigo: a.codigo });
    return novo;
  });

  app.patch("/api/marketing/afiliados/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await carregarAfiliado(req.usuario!, id);
    const dados = esquemaAfiliado.partial().parse(req.body);
    if (dados.unidadeId !== undefined) exigirAlterar(req.usuario!, dados.unidadeId);
    if (dados.codigo) await garantirCodigoLivre(dados.codigo, id);
    const [novo] = await db.update(afiliados).set({ ...dados, atualizadoEm: new Date() }).where(eq(afiliados.id, id)).returning();
    await auditar(db, req, "AFILIADO_EDITADO", { tipo: "afiliado", id }, { campos: Object.keys(dados) });
    return novo;
  });

  app.delete("/api/marketing/afiliados/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const a = await carregarAfiliado(req.usuario!, id);
    await db.delete(afiliados).where(eq(afiliados.id, id));
    await auditar(db, req, "AFILIADO_EXCLUIDO", { tipo: "afiliado", id }, { nome: a.nome, codigo: a.codigo });
    return { ok: true };
  });
}
