import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { IDIOMAS, MODELOS_AVALIACAO, STATUS_PEDIDO_AVALIACAO, lembreteDevido, mediaNotas, type Idioma } from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { avaliacaoExternas, avaliacaoNotas, avaliacaoPedidos, npsRespostas, passageiros, passeios, pessoas, reservas, saidas, unidades } from "../db/schema.js";
import { filtroUnidade, garantirReserva, podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";
import { envioReal } from "../servicos/whatsapp.js";
import { enviarPedidoAvaliacao, gerarPedidosAvaliacao, lerConfigAvaliacao, pendentesSemNps, textoDoPedido } from "../servicos/avaliacoes.js";
import { chaveLinkGoogle, dataIso, exigirPraca, gravarChave, hojeSp, naoEncontrado, periodoPadrao, segundaDaSemana, somarDias, texto, textoOpc, urlHttps, uuid, visivel } from "../servicos/marketingComum.js";

const CANAIS_EXTERNOS = ["GOOGLE", "TRIPADVISOR", "VIATOR", "CIVITATIS", "DECOLAR", "OUTRO"] as const;
const FEITOS = ["ENVIADA_MANUAL", "SIMULADA", "ENVIADA", "LEMBRADA", "AVALIADA"];
const canalExpr = sql<string>`coalesce(${reservas.canalOrigem}, ${reservas.canal})::text`;

export async function rotasAvaliacoes(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "marketing:ver") };
  const gerenciar = { preHandler: exigir(config, "marketing:gerenciar") };
  const periodo = periodoPadrao();

  const escopoDe = (u: UsuarioSessao, p: { de: string; ate: string; unidadeId?: string }) => {
    exigirPraca(u, p.unidadeId);
    return and(gte(saidas.data, p.de), lte(saidas.data, p.ate), filtroUnidade(u), p.unidadeId ? eq(passeios.unidadeId, p.unidadeId) : undefined);
  };

  // ───────────── Configuração (modelos por idioma, Tripadvisor, Google por praça) ─────────────

  async function configCompleta(u: UsuarioSessao) {
    const cfg = await lerConfigAvaliacao(db);
    const pracas = await db.select({ id: unidades.id, codigo: unidades.codigo, nome: unidades.nome }).from(unidades).where(eq(unidades.ativa, true)).orderBy(asc(unidades.nome));
    return {
      modelos: { pt: cfg.modelos.pt ?? MODELOS_AVALIACAO.pt, en: cfg.modelos.en ?? MODELOS_AVALIACAO.en, es: cfg.modelos.es ?? MODELOS_AVALIACAO.es },
      padroes: MODELOS_AVALIACAO,
      linkTripadvisor: cfg.linkTripadvisor,
      linksGoogle: pracas.filter((p) => podeUnidade(u, p.id)).map((p) => ({ unidadeId: p.id, codigo: p.codigo, nome: p.nome, link: cfg.googlePorUnidade.get(p.id) ?? null })),
      envio: { real: envioReal(config), nota: envioReal(config) ? "Envio real pelo WhatsApp ligado." : "Modo simulado: nada sai de verdade; o pedido fica como “Simulada”." },
    };
  }
  app.get("/api/marketing/avaliacoes/config", ver, async (req) => configCompleta(req.usuario!));

  app.patch("/api/marketing/avaliacoes/config", gerenciar, async (req) => {
    const u = req.usuario!;
    const c = z.object({
      modelos: z.object({ pt: texto(1000).min(10), en: texto(1000).min(10), es: texto(1000).min(10) }).partial().optional(),
      linkTripadvisor: urlHttps.nullish(),
      linksGoogle: z.array(z.object({ unidadeId: uuid, link: urlHttps.nullable() })).max(50).optional(),
    }).parse(req.body);
    if (c.modelos) {
      for (const i of IDIOMAS) if (c.modelos[i] !== undefined) await gravarChave(db, i === "pt" ? "modelo_avaliacao" : `modelo_avaliacao_${i}`, c.modelos[i]!, u.id);
    }
    if (c.linkTripadvisor !== undefined) await gravarChave(db, "link_tripadvisor", c.linkTripadvisor, u.id);
    for (const l of c.linksGoogle ?? []) {
      // Link de uma praça: só quem tem a praça altera.
      if (!podeUnidade(u, l.unidadeId)) throw naoEncontrado("Praça");
      await gravarChave(db, chaveLinkGoogle(l.unidadeId), l.link, u.id);
    }
    await auditar(db, req, "MARKETING_CONFIG_EDITADA", { tipo: "marketing_config" }, { campos: [...Object.keys(c)] });
    return configCompleta(u);
  });

  // ───────────── Resumo e painel ─────────────

  /** Notas internas, funil dos pedidos, taxa de pedidos, evolução semanal e destaque da Viator. Só agregados. */
  app.get("/api/marketing/avaliacoes/resumo", ver, async (req) => {
    const p = periodo.parse(req.query);
    const u = req.usuario!;
    const escopo = escopoDe(u, p);
    const notas = await db.select({ nota: avaliacaoNotas.nota, guia: pessoas.nome, canal: canalExpr }).from(avaliacaoNotas)
      .innerJoin(reservas, eq(reservas.id, avaliacaoNotas.reservaId)).innerJoin(saidas, eq(saidas.id, avaliacaoNotas.saidaId))
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId)).leftJoin(pessoas, eq(pessoas.id, saidas.guiaId)).where(escopo);
    const pedidos = await db.select({ status: avaliacaoPedidos.status, n: sql<number>`count(*)::int` }).from(avaliacaoPedidos)
      .innerJoin(saidas, eq(saidas.id, avaliacaoPedidos.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(escopo).groupBy(avaliacaoPedidos.status);
    const reservasN = sql<number>`count(distinct ${reservas.id})::int`;
    const passageirosN = sql<number>`count(${passageiros.id})::int`;
    const [viator] = await db.select({ reservas: reservasN, passageiros: passageirosN }).from(reservas)
      .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .leftJoin(passageiros, eq(passageiros.reservaId, reservas.id))
      .where(and(eq(reservas.status, "CONFIRMADA"), escopo, sql`coalesce(${reservas.canalOrigem}, ${reservas.canal}) = 'VIATOR'`));
    // Elegíveis: reservas já realizadas (saída até ontem) com ao menos um passageiro que veio.
    const ate = p.ate < hojeSp() ? p.ate : somarDias(hojeSp(), -1);
    const [{ elegiveis } = { elegiveis: 0 }] = await db.select({ elegiveis: reservasN }).from(reservas)
      .innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(and(eq(reservas.status, "CONFIRMADA"), sql`${saidas.status} <> 'CANCELADA'`, gte(saidas.data, p.de), lte(saidas.data, ate), filtroUnidade(u), p.unidadeId ? eq(passeios.unidadeId, p.unidadeId) : undefined,
        sql`exists (select 1 from ${passageiros} where ${passageiros.reservaId} = ${reservas.id} and ${passageiros.embarque} <> 'NO_SHOW')`));
    const semanaExpr = sql<string>`to_char(date_trunc('week', ${saidas.data}::timestamp), 'YYYY-MM-DD')`;
    const porSemana = await db.select({
      semana: semanaExpr, pedidos: sql<number>`count(*)::int`,
      feitos: sql<number>`count(*) filter (where ${avaliacaoPedidos.status} in ('ENVIADA_MANUAL','SIMULADA','ENVIADA','LEMBRADA','AVALIADA'))::int`,
      avaliados: sql<number>`count(*) filter (where ${avaliacaoPedidos.status} = 'AVALIADA')::int`,
    }).from(avaliacaoPedidos).innerJoin(saidas, eq(saidas.id, avaliacaoPedidos.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(escopo).groupBy(semanaExpr).orderBy(asc(semanaExpr));
    const [lemb] = await db.select({ n: sql<number>`count(*)::int` }).from(avaliacaoPedidos).innerJoin(saidas, eq(saidas.id, avaliacaoPedidos.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .where(and(escopo, inArray(avaliacaoPedidos.status, ["ENVIADA_MANUAL", "SIMULADA", "ENVIADA"]), sql`${avaliacaoPedidos.pedidoEm} <= now() - interval '7 days'`));
    const contagem = Object.fromEntries(STATUS_PEDIDO_AVALIACAO.map((s) => [s, pedidos.find((x) => x.status === s)?.n ?? 0])) as Record<string, number>;
    const feitos = FEITOS.reduce((s, k) => s + (contagem[k] ?? 0), 0);
    const agrupar = (chave: (n: (typeof notas)[number]) => string) => {
      const m = new Map<string, number[]>();
      for (const n of notas) m.set(chave(n), [...(m.get(chave(n)) ?? []), n.nota]);
      return [...m.entries()].map(([k, v]) => ({ chave: k, quantidade: v.length, media: mediaNotas(v) })).sort((a, b) => b.quantidade - a.quantidade);
    };
    const cfg = await lerConfigAvaliacao(db);
    return {
      periodo: { de: p.de, ate: p.ate },
      notas: {
        quantidade: notas.length, media: mediaNotas(notas.map((n) => n.nota)),
        distribuicao: [1, 2, 3, 4, 5].map((v) => ({ nota: v, quantidade: notas.filter((n) => n.nota === v).length })),
        porGuia: agrupar((n) => n.guia ?? "Sem guia"), porCanal: agrupar((n) => n.canal),
      },
      pedidos: contagem,
      funil: {
        elegiveis, pedidos: Object.values(contagem).reduce((s, n) => s + n, 0), feitos, avaliados: contagem.AVALIADA ?? 0, lembretesSugeridos: lemb?.n ?? 0,
        taxaPedidos: elegiveis ? Math.round((feitos / elegiveis) * 1000) / 10 : null,
        taxaAvaliacao: feitos ? Math.round(((contagem.AVALIADA ?? 0) / feitos) * 1000) / 10 : null,
      },
      semanal: porSemana,
      tripadvisor: { reservasViator: viator?.reservas ?? 0, passageirosViator: viator?.passageiros ?? 0, link: cfg.linkTripadvisor },
    };
  });

  // ───────────── Notas e quantidade nos canais (lançamento manual, também de concorrentes) ─────────────

  app.get("/api/marketing/avaliacoes/externas", ver, async (req) => {
    const q = z.object({ de: dataIso.optional(), ate: dataIso.optional() }).parse(req.query);
    const de = q.de ?? somarDias(hojeSp(), -180), ate = q.ate ?? hojeSp();
    return db.select().from(avaliacaoExternas).where(and(gte(avaliacaoExternas.semana, segundaDaSemana(de)), lte(avaliacaoExternas.semana, ate), visivel(req.usuario!, avaliacaoExternas.unidadeId)))
      .orderBy(asc(avaliacaoExternas.semana), asc(avaliacaoExternas.canal), asc(avaliacaoExternas.alvo)).limit(2000)
      .then((l) => l.map((x) => ({ id: x.id, semana: x.semana, canal: x.canal, alvo: x.alvo, unidadeId: x.unidadeId, notaCentesimos: x.notaCentesimos, quantidade: x.quantidade })));
  });

  app.post("/api/marketing/avaliacoes/externas", gerenciar, async (req) => {
    const u = req.usuario!;
    const c = z.object({
      data: dataIso.default(() => hojeSp()), canal: z.enum(CANAIS_EXTERNOS), concorrente: textoOpc(80),
      unidadeId: uuid.nullish().transform((v) => v ?? null),
      nota: z.number().min(1).max(5).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Use no máximo duas casas decimais."),
      quantidade: z.number().int().min(0).max(1_000_000),
    }).parse(req.body);
    if (c.unidadeId ? !podeUnidade(u, c.unidadeId) : !u.todasUnidades) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem enxerga todas as praças lança notas de todas as praças.");
    const semana = segundaDaSemana(c.data);
    const alvo = c.concorrente ?? "PROPRIA";
    const [ja] = await db.select({ id: avaliacaoExternas.id }).from(avaliacaoExternas).where(and(eq(avaliacaoExternas.semana, semana), eq(avaliacaoExternas.canal, c.canal), eq(avaliacaoExternas.alvo, alvo),
      c.unidadeId ? eq(avaliacaoExternas.unidadeId, c.unidadeId) : sql`${avaliacaoExternas.unidadeId} is null`));
    const valores = { notaCentesimos: Math.round(c.nota * 100), quantidade: c.quantidade, registradoPor: u.id };
    const [x] = ja
      ? await db.update(avaliacaoExternas).set(valores).where(eq(avaliacaoExternas.id, ja.id)).returning()
      : await db.insert(avaliacaoExternas).values({ semana, canal: c.canal, alvo, unidadeId: c.unidadeId, ...valores }).returning();
    await auditar(db, req, "AVALIACAO_EXTERNA_LANCADA", { tipo: "avaliacao_externa", id: x!.id }, { semana, canal: c.canal, alvo: alvo === "PROPRIA" ? alvo : "CONCORRENTE", nota: c.nota, quantidade: c.quantidade });
    return { id: x!.id, semana, canal: c.canal, alvo, unidadeId: c.unidadeId, notaCentesimos: x!.notaCentesimos, quantidade: x!.quantidade };
  });

  app.delete("/api/marketing/avaliacoes/externas/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [x] = await db.select().from(avaliacaoExternas).where(and(eq(avaliacaoExternas.id, id), visivel(req.usuario!, avaliacaoExternas.unidadeId)));
    if (!x) throw naoEncontrado("Lançamento");
    if (x.unidadeId ? !podeUnidade(req.usuario!, x.unidadeId) : !req.usuario!.todasUnidades) throw new ErroHttp(403, "SEM_PERMISSAO", "Você não pode alterar este lançamento.");
    await db.delete(avaliacaoExternas).where(eq(avaliacaoExternas.id, id));
    await auditar(db, req, "AVALIACAO_EXTERNA_REMOVIDA", { tipo: "avaliacao_externa", id }, { semana: x.semana, canal: x.canal });
    return { ok: true };
  });

  // ───────────── Fila de pedidos ─────────────

  app.get("/api/marketing/avaliacoes/pedidos", ver, async (req) => {
    const q = z.object({ status: z.enum(STATUS_PEDIDO_AVALIACAO).optional() }).and(periodo).parse(req.query);
    const u = req.usuario!;
    exigirPraca(u, q.unidadeId);
    const linhas = await db.select({
      id: avaliacaoPedidos.id, reservaId: avaliacaoPedidos.reservaId, status: avaliacaoPedidos.status, texto: avaliacaoPedidos.texto, idioma: avaliacaoPedidos.idioma,
      canalAvaliacao: avaliacaoPedidos.canalAvaliacao, link: avaliacaoPedidos.link, pedidoEm: avaliacaoPedidos.pedidoEm, lembreteEm: avaliacaoPedidos.lembreteEm, avaliadoEm: avaliacaoPedidos.avaliadoEm,
      data: saidas.data, passeio: passeios.nome, canal: canalExpr, temTelefone: sql<boolean>`coalesce(length(trim(${reservas.contatoTelefone})) > 0, false)`,
      nps: sql<string | null>`case when ${npsRespostas.id} is null then null when ${npsRespostas.respondidoEm} is null then 'ENVIADO' else 'RESPONDIDO' end`,
    }).from(avaliacaoPedidos).innerJoin(reservas, eq(reservas.id, avaliacaoPedidos.reservaId)).innerJoin(saidas, eq(saidas.id, avaliacaoPedidos.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId))
      .leftJoin(npsRespostas, eq(npsRespostas.reservaId, avaliacaoPedidos.reservaId))
      .where(and(gte(saidas.data, q.de), lte(saidas.data, q.ate), filtroUnidade(u), q.unidadeId ? eq(passeios.unidadeId, q.unidadeId) : undefined, q.status ? eq(avaliacaoPedidos.status, q.status) : undefined))
      .orderBy(desc(saidas.data), asc(avaliacaoPedidos.criadoEm)).limit(500);
    const agora = new Date();
    return linhas.map((l) => ({ ...l, lembreteSugerido: lembreteDevido(l.pedidoEm?.toISOString() ?? null, l.status, agora) }));
  });

  /** Cria os pedidos das reservas já realizadas no período (um por reserva; repetir não duplica). Não envia nada. */
  app.post("/api/marketing/avaliacoes/pedidos/gerar", gerenciar, async (req) => {
    const u = req.usuario!;
    // Padrão próprio: últimos 7 dias até ontem (passeios já realizados). Corpo ausente é aceito.
    const q = z.object({ de: dataIso.optional(), ate: dataIso.optional(), unidadeId: uuid.optional() }).parse(req.body ?? {});
    const ate = q.ate ?? somarDias(hojeSp(), -1);
    const p = { de: q.de ?? somarDias(ate, -6), ate, unidadeId: q.unidadeId };
    if (p.de > p.ate) throw new ErroHttp(400, "PERIODO_INVALIDO", "A data inicial deve ser anterior à final.");
    exigirPraca(u, p.unidadeId);
    if ((Date.parse(p.ate) - Date.parse(p.de)) / 86400_000 > 31) throw new ErroHttp(400, "PERIODO_LONGO", "Gere os pedidos de no máximo 31 dias por vez.");
    const ateEfetivo = p.ate < hojeSp() ? p.ate : somarDias(hojeSp(), -1);
    const criados = await gerarPedidosAvaliacao(db, { de: p.de, ate: ateEfetivo, filtro: filtroUnidade(u), unidadeId: p.unidadeId });
    await auditar(db, req, "AVALIACAO_PEDIDOS_GERADOS", { tipo: "avaliacao_pedido" }, { de: p.de, ate: ateEfetivo, criados });
    return { criados, periodo: { de: p.de, ate: ateEfetivo }, envio: "NAO_ENVIADO" };
  });

  async function carregarPedido(u: UsuarioSessao, id: string) {
    const [p] = await db.select().from(avaliacaoPedidos).where(eq(avaliacaoPedidos.id, id));
    if (!p) throw naoEncontrado("Pedido de avaliação");
    await garantirReserva(db, u, p.reservaId);
    return p;
  }

  /** Marcações manuais (à mão, lembrada, avaliada, ignorada), idioma, canal/link e o texto editado. SIMULADA/ENVIADA só pelo envio. */
  app.patch("/api/marketing/avaliacoes/pedidos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = z.object({
      status: z.enum(["PENDENTE", "ENVIADA_MANUAL", "LEMBRADA", "AVALIADA", "IGNORADA"]).optional(),
      texto: texto(1000).min(5).optional(),
      idioma: z.enum(IDIOMAS).optional(),
      canalAvaliacao: z.enum(["GOOGLE", "TRIPADVISOR"]).optional(),
    }).parse(req.body);
    const atual = await carregarPedido(req.usuario!, id);
    const set: Partial<typeof avaliacaoPedidos.$inferInsert> = { atualizadoEm: new Date() };
    if (c.idioma || c.canalAvaliacao) {
      if (atual.canalAvaliacao === "VIATOR" && c.canalAvaliacao) throw new ErroHttp(400, "CANAL_VIATOR", "Quem comprou pela Viator avalia na própria Viator.");
      const t = await textoDoPedido(db, id, { idioma: c.idioma as Idioma | undefined, canal: c.canalAvaliacao });
      Object.assign(set, { texto: t.texto, canalAvaliacao: t.canal, link: t.link, idioma: t.idioma });
    }
    if (c.texto) set.texto = c.texto;
    if (c.status) {
      set.status = c.status;
      const agora = new Date();
      if (c.status === "ENVIADA_MANUAL") set.pedidoEm = atual.pedidoEm ?? agora;
      if (c.status === "LEMBRADA") { set.lembreteEm = agora; set.pedidoEm = atual.pedidoEm ?? agora; }
      if (c.status === "AVALIADA") { set.avaliadoEm = agora; set.pedidoEm = atual.pedidoEm ?? agora; }
      if (c.status === "PENDENTE") { set.pedidoEm = null; set.lembreteEm = null; set.avaliadoEm = null; }
    }
    await db.update(avaliacaoPedidos).set(set).where(eq(avaliacaoPedidos.id, id));
    await auditar(db, req, "AVALIACAO_PEDIDO_ATUALIZADO", { tipo: "avaliacao_pedido", id }, { status: c.status ?? null, idioma: c.idioma ?? null, canal: c.canalAvaliacao ?? null, textoEditado: !!c.texto });
    return { ok: true };
  });

  /** Envia o pedido (ou o lembrete) pela fila de mensagens. No modo simulado nada sai: o pedido fica "Simulada". */
  app.post("/api/marketing/avaliacoes/pedidos/:id/enviar", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { lembrete } = z.object({ lembrete: z.boolean().default(false) }).parse(req.body ?? {});
    await carregarPedido(req.usuario!, id);
    const r = await enviarPedidoAvaliacao(db, config, id, lembrete);
    await auditar(db, req, lembrete ? "AVALIACAO_LEMBRETE_ENVIADO" : "AVALIACAO_PEDIDO_ENVIADO", { tipo: "avaliacao_pedido", id }, { status: r.status });
    return { ...r, simulado: !envioReal(config) };
  });

  /** Envia de uma vez os pedidos a enviar do período (menos os de quem recebe o NPS: o convite vai pela página dele). */
  app.post("/api/marketing/avaliacoes/pedidos/enviar-pendentes", gerenciar, async (req) => {
    const u = req.usuario!;
    const p = periodo.parse(req.body ?? {});
    exigirPraca(u, p.unidadeId);
    const ids = await pendentesSemNps(db, p.de, p.ate, and(filtroUnidade(u), p.unidadeId ? eq(passeios.unidadeId, p.unidadeId) : undefined));
    let enviados = 0, falhas = 0;
    for (const id of ids) {
      try { await enviarPedidoAvaliacao(db, config, id, false); enviados++; } catch { falhas++; }
    }
    await auditar(db, req, "AVALIACAO_PEDIDOS_ENVIADOS_EM_LOTE", { tipo: "avaliacao_pedido" }, { enviados, falhas });
    return { enviados, falhas, simulado: !envioReal(config) };
  });

  // ───────────── Notas internas (coluna "Pesquisa" da lista em papel) ─────────────

  app.get("/api/marketing/avaliacoes/notas", ver, async (req) => {
    const p = periodo.parse(req.query);
    const u = req.usuario!;
    exigirPraca(u, p.unidadeId);
    return db.select({ id: avaliacaoNotas.id, reservaId: avaliacaoNotas.reservaId, nota: avaliacaoNotas.nota, comentario: avaliacaoNotas.comentario, data: saidas.data, passeio: passeios.nome, canal: canalExpr, guia: pessoas.nome })
      .from(avaliacaoNotas).innerJoin(reservas, eq(reservas.id, avaliacaoNotas.reservaId)).innerJoin(saidas, eq(saidas.id, avaliacaoNotas.saidaId))
      .innerJoin(passeios, eq(passeios.id, saidas.passeioId)).leftJoin(pessoas, eq(pessoas.id, saidas.guiaId))
      .where(and(gte(saidas.data, p.de), lte(saidas.data, p.ate), filtroUnidade(u), p.unidadeId ? eq(passeios.unidadeId, p.unidadeId) : undefined))
      .orderBy(desc(saidas.data), desc(avaliacaoNotas.criadoEm)).limit(500);
  });

  app.post("/api/marketing/avaliacoes/notas", gerenciar, async (req) => {
    const c = z.object({ reservaId: uuid, nota: z.number().int().min(1).max(5), comentario: textoOpc(500) }).parse(req.body);
    await garantirReserva(db, req.usuario!, c.reservaId);
    const [r] = await db.select({ saidaId: reservas.saidaId }).from(reservas).where(eq(reservas.id, c.reservaId));
    const [n] = await db.insert(avaliacaoNotas).values({ reservaId: c.reservaId, saidaId: r!.saidaId, nota: c.nota, comentario: c.comentario, registradoPor: req.usuario!.id })
      .onConflictDoUpdate({ target: avaliacaoNotas.reservaId, set: { nota: c.nota, comentario: c.comentario, registradoPor: req.usuario!.id } }).returning();
    await auditar(db, req, "AVALIACAO_NOTA_REGISTRADA", { tipo: "reserva", id: c.reservaId }, { nota: c.nota });
    return n;
  });
}
