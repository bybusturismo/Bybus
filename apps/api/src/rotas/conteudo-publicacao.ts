import { TIPOS_POST_INSTAGRAM, validarAgendamento, CARROSSEL_MAX } from "@bybus/core";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { bancoMidias, conteudoMidias, conteudos, passeios } from "../db/schema.js";
import { filtroUnidade, podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, exigir, nomeCookie, type UsuarioSessao } from "../seguranca/sessao.js";
import { detectarTipo, disposicao, nomeSeguro, LIMITES } from "../servicos/bibliotecaAnexos.js";
import { sugerirLegendas } from "../servicos/ia/legendas.js";
import { ErroIA } from "../servicos/ia/cliente.js";

/**
 * Calendário de conteúdo: mídia do post, aprovação, agendamento no Instagram, banco de mídias e sugestão de legenda por IA.
 * Regra central: só post APROVADO por quem tem marketing:gerenciar pode ser agendado — e a rotina só publica o que foi aprovado.
 */

const uuid = z.string().uuid();
/** O Instagram só aceita imagem JPEG e vídeo MP4 na publicação pela API (a confirmar na doc oficial). */
const TIPOS_PUBLICAVEIS = ["image/jpeg", "video/mp4"] as const;
const TIPOS_BANCO = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"] as const;
const MAX_BANCO = 500;

function visivel(u: UsuarioSessao, coluna: AnyPgColumn): SQL | undefined {
  const escopo = filtroUnidade(u, coluna as never);
  return escopo ? or(sql`${coluna} is null`, escopo) : undefined;
}
const naoEncontrado = (o = "Conteúdo") => new ErroHttp(404, "NAO_ENCONTRADO", `${o} não encontrado(a).`);

export async function rotasConteudoPublicacao(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "marketing:ver") };
  const gerenciar = { preHandler: exigir(config, "marketing:gerenciar") };

  /** Conteúdo visível; para alterar, praça do usuário (ou todas as praças quando o item é de todas). */
  async function carregar(u: UsuarioSessao, id: string, alterar: boolean) {
    const [c] = await db.select().from(conteudos).where(and(eq(conteudos.id, id), visivel(u, conteudos.unidadeId)));
    if (!c) throw naoEncontrado();
    if (alterar && !(c.unidadeId ? podeUnidade(u, c.unidadeId) : u.todasUnidades)) throw new ErroHttp(403, "SEM_PERMISSAO", "Você só pode alterar itens das suas praças.");
    return c;
  }
  const naoMexer = (c: typeof conteudos.$inferSelect) => {
    if (c.pubStatus === "PUBLICANDO") throw new ErroHttp(409, "PUBLICANDO", "Este post está sendo publicado agora. Tente de novo em instantes.");
    if (c.status === "PUBLICADO") throw new ErroHttp(409, "JA_PUBLICADO", "Este post já foi publicado.");
  };
  /** Mexer na mídia de um post aprovado/agendado desfaz a aprovação (quem aprovou não viu a versão nova). */
  async function perderAprovacao(c: typeof conteudos.$inferSelect) {
    if (c.status === "APROVADO" || c.status === "AGENDADO") {
      await db.update(conteudos).set({ status: "EM_APROVACAO", aprovadoEm: null, aprovadoPor: null, pubStatus: null, pubErro: null, pubContainerId: null, atualizadoEm: new Date() }).where(eq(conteudos.id, c.id));
    }
  }

  // ───────────── Mídia do post ─────────────
  // Corpo cru (sem pacote de upload), como os anexos da Biblioteca: o Content-Type é o do arquivo, o tipo real vem do conteúdo.
  await app.register(async (envio) => {
    envio.removeContentTypeParser("text/plain");
    envio.addContentTypeParser(/^(image|video)\//, { parseAs: "buffer", bodyLimit: LIMITES.VIDEO }, (_req, corpo, feito) => feito(null, corpo));

    function aoReceber(limitesPorTipo: readonly string[]) {
      return async (req: import("fastify").FastifyRequest) => {
        if (!req.cookies[nomeCookie(config)]) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
        const tipo = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        if (!limitesPorTipo.includes(tipo)) throw new ErroHttp(400, "TIPO_INVALIDO", "Tipo de arquivo não permitido.");
        const limite = tipo.startsWith("video/") ? LIMITES.VIDEO : LIMITES.IMAGEM;
        if (Number(req.headers["content-length"] ?? 0) > limite) throw new ErroHttp(413, "ARQUIVO_GRANDE", "Arquivo grande demais para este tipo.");
      };
    }
    /** Confere o conteúdo real (não só o cabeçalho), o tamanho e devolve os dados. */
    function conferir(req: import("fastify").FastifyRequest, permitidos: readonly string[], nome: string) {
      const dados = req.body as Buffer;
      if (!Buffer.isBuffer(dados) || dados.length === 0) throw new ErroHttp(400, "ARQUIVO_VAZIO", "Arquivo vazio.");
      const declarado = String(req.headers["content-type"]).split(";")[0]!.trim().toLowerCase();
      const real = detectarTipo(dados, nome);
      if (!real || real.tipo !== declarado || !permitidos.includes(real.tipo) || (real.uso !== "IMAGEM" && real.uso !== "VIDEO")) {
        throw new ErroHttp(400, "TIPO_INVALIDO", "O conteúdo do arquivo não confere com o tipo informado, ou o tipo não é permitido.");
      }
      if (dados.length > LIMITES[real.uso]) throw new ErroHttp(413, "ARQUIVO_GRANDE", "Arquivo grande demais para este tipo.");
      return { dados, tipo: real.tipo, uso: real.uso as "IMAGEM" | "VIDEO" };
    }

    envio.post("/api/marketing/conteudos/:id/midias", { bodyLimit: LIMITES.VIDEO, onRequest: aoReceber(TIPOS_PUBLICAVEIS), preHandler: exigir(config, "marketing:gerenciar") }, async (req) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const { nome } = z.object({ nome: z.string().trim().min(1).max(200) }).parse(req.query);
      const c = await carregar(req.usuario!, id, true);
      naoMexer(c);
      const { dados, tipo, uso } = conferir(req, TIPOS_PUBLICAVEIS, nome);
      const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(conteudoMidias).where(eq(conteudoMidias.conteudoId, id));
      if (n >= CARROSSEL_MAX) throw new ErroHttp(400, "MUITAS_MIDIAS", `Um post aceita no máximo ${CARROSSEL_MAX} mídias.`);
      const [nova] = await db.insert(conteudoMidias).values({ conteudoId: id, ordem: n, nome: nomeSeguro(nome), tipo, uso, tamanho: dados.length, dados, criadoPor: req.usuario!.id }).returning({ id: conteudoMidias.id });
      await perderAprovacao(c);
      await auditar(db, req, "CONTEUDO_MIDIA_ENVIADA", { tipo: "conteudo", id }, { midia: nova!.id, tipo, tamanho: dados.length });
      return { id: nova!.id, nome: nomeSeguro(nome), tipo, uso, tamanho: dados.length, ordem: n };
    });

    envio.post("/api/marketing/banco-midias", { bodyLimit: LIMITES.VIDEO, onRequest: aoReceber(TIPOS_BANCO), preHandler: exigir(config, "marketing:gerenciar") }, async (req) => {
      const q = z.object({
        nome: z.string().trim().min(1).max(200), passeio: z.string().trim().max(120).optional(), pontoTuristico: z.string().trim().max(120).optional(), temporada: z.string().trim().max(60).optional(),
      }).parse(req.query);
      const { dados, tipo, uso } = conferir(req, TIPOS_BANCO, q.nome);
      const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(bancoMidias);
      if (n >= MAX_BANCO) throw new ErroHttp(400, "BANCO_CHEIO", "O banco de mídias chegou ao limite. Exclua o que não usa mais.");
      const [nova] = await db.insert(bancoMidias).values({ nome: nomeSeguro(q.nome), tipo, uso, tamanho: dados.length, dados, passeio: q.passeio || null, pontoTuristico: q.pontoTuristico || null, temporada: q.temporada || null, criadoPor: req.usuario!.id }).returning({ id: bancoMidias.id });
      await auditar(db, req, "BANCO_MIDIA_ENVIADA", { tipo: "banco_midia", id: nova!.id }, { tipo, tamanho: dados.length });
      return { id: nova!.id, nome: nomeSeguro(q.nome), tipo, uso, tamanho: dados.length };
    });
  });

  app.get("/api/marketing/conteudos/:id/midias", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await carregar(req.usuario!, id, false);
    return db.select({ id: conteudoMidias.id, nome: conteudoMidias.nome, tipo: conteudoMidias.tipo, uso: conteudoMidias.uso, tamanho: conteudoMidias.tamanho, ordem: conteudoMidias.ordem })
      .from(conteudoMidias).where(eq(conteudoMidias.conteudoId, id)).orderBy(asc(conteudoMidias.ordem), asc(conteudoMidias.criadoEm));
  });

  const entregar = (reply: import("fastify").FastifyReply, m: { tipo: string; nome: string; uso: string; dados: Buffer }) =>
    reply.header("Content-Type", m.tipo).header("Content-Disposition", disposicao("IMAGEM", m.nome)).header("Cache-Control", "private, max-age=600")
      .header("X-Content-Type-Options", "nosniff").header("Content-Security-Policy", "sandbox; default-src 'none'").header("Content-Length", m.dados.length).send(m.dados);

  app.get("/api/marketing/conteudos/:id/midias/:midiaId", ver, async (req, reply) => {
    const { id, midiaId } = z.object({ id: uuid, midiaId: uuid }).parse(req.params);
    await carregar(req.usuario!, id, false);
    const [m] = await db.select().from(conteudoMidias).where(and(eq(conteudoMidias.id, midiaId), eq(conteudoMidias.conteudoId, id)));
    if (!m) throw naoEncontrado("Mídia");
    return entregar(reply, m);
  });

  app.delete("/api/marketing/conteudos/:id/midias/:midiaId", gerenciar, async (req) => {
    const { id, midiaId } = z.object({ id: uuid, midiaId: uuid }).parse(req.params);
    const c = await carregar(req.usuario!, id, true);
    naoMexer(c);
    const apagadas = await db.delete(conteudoMidias).where(and(eq(conteudoMidias.id, midiaId), eq(conteudoMidias.conteudoId, id))).returning({ id: conteudoMidias.id });
    if (!apagadas.length) throw naoEncontrado("Mídia");
    // Reordena para não deixar buraco.
    const resto = await db.select({ id: conteudoMidias.id }).from(conteudoMidias).where(eq(conteudoMidias.conteudoId, id)).orderBy(asc(conteudoMidias.ordem), asc(conteudoMidias.criadoEm));
    for (const [i, m] of resto.entries()) await db.update(conteudoMidias).set({ ordem: i }).where(eq(conteudoMidias.id, m.id));
    await perderAprovacao(c);
    await auditar(db, req, "CONTEUDO_MIDIA_REMOVIDA", { tipo: "conteudo", id }, { midia: midiaId });
    return { ok: true };
  });

  // ───────────── Aprovação ─────────────
  app.post("/api/marketing/conteudos/:id/solicitar-aprovacao", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = await carregar(req.usuario!, id, true);
    if (!["IDEIA", "PRODUCAO"].includes(c.status)) throw new ErroHttp(409, "SITUACAO_INVALIDA", "Só ideias e rascunhos vão para aprovação.");
    await db.update(conteudos).set({ status: "EM_APROVACAO", atualizadoEm: new Date() }).where(eq(conteudos.id, id));
    await auditar(db, req, "CONTEUDO_APROVACAO_SOLICITADA", { tipo: "conteudo", id }, {});
    return { status: "EM_APROVACAO" };
  });

  app.post("/api/marketing/conteudos/:id/aprovar", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = await carregar(req.usuario!, id, true);
    if (c.status !== "EM_APROVACAO") throw new ErroHttp(409, "SITUACAO_INVALIDA", "Só posts “em aprovação” podem ser aprovados.");
    await db.update(conteudos).set({ status: "APROVADO", aprovadoPor: req.usuario!.id, aprovadoEm: new Date(), atualizadoEm: new Date() }).where(and(eq(conteudos.id, id), eq(conteudos.status, "EM_APROVACAO")));
    await auditar(db, req, "CONTEUDO_APROVADO", { tipo: "conteudo", id }, {});
    return { status: "APROVADO" };
  });

  /** Devolve para rascunho (reprovar ou desfazer a aprovação). Tira da fila de publicação se estava agendado. */
  app.post("/api/marketing/conteudos/:id/devolver", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = await carregar(req.usuario!, id, true);
    naoMexer(c);
    if (!["EM_APROVACAO", "APROVADO", "AGENDADO"].includes(c.status)) throw new ErroHttp(409, "SITUACAO_INVALIDA", "Este post não está em aprovação, aprovado nem agendado.");
    await db.update(conteudos).set({ status: "PRODUCAO", aprovadoEm: null, aprovadoPor: null, pubStatus: null, pubErro: null, pubContainerId: null, agendarEm: null, atualizadoEm: new Date() }).where(eq(conteudos.id, id));
    await auditar(db, req, "CONTEUDO_DEVOLVIDO", { tipo: "conteudo", id }, { de: c.status });
    return { status: "PRODUCAO" };
  });

  // ───────────── Agendamento no Instagram ─────────────
  app.post("/api/marketing/conteudos/:id/agendar", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({ tipoPost: z.enum(TIPOS_POST_INSTAGRAM), agendarEm: z.string().datetime({ offset: true }) }).parse(req.body);
    const c = await carregar(req.usuario!, id, true);
    naoMexer(c);
    if (c.status !== "APROVADO" && !(c.status === "AGENDADO" && c.pubStatus === "FALHOU")) {
      throw new ErroHttp(409, "NAO_APROVADO", "Só é possível agendar um post aprovado. Envie para aprovação e aprove antes.");
    }
    if (!c.aprovadoEm && c.status !== "AGENDADO") throw new ErroHttp(409, "NAO_APROVADO", "Só é possível agendar um post aprovado.");
    const midias = await db.select({ uso: conteudoMidias.uso, tipo: conteudoMidias.tipo }).from(conteudoMidias).where(eq(conteudoMidias.conteudoId, id));
    const quando = new Date(corpo.agendarEm);
    const erros = validarAgendamento({ rede: c.rede, tipo: corpo.tipoPost, legenda: c.legenda, agendarEm: quando, midias: midias.map((m) => ({ uso: m.uso as "IMAGEM" | "VIDEO", tipo: m.tipo })) });
    if (erros.length) throw new ErroHttp(400, "AGENDAMENTO_INVALIDO", erros.join(" "));
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(quando);
    await db.update(conteudos).set({ status: "AGENDADO", tipoPost: corpo.tipoPost, agendarEm: quando, dataPrevista: dia, pubStatus: "AGENDADO", pubErro: null, pubContainerId: null, pubTentativas: 0, pubProximaEm: null, atualizadoEm: new Date() }).where(eq(conteudos.id, id));
    await auditar(db, req, "CONTEUDO_AGENDADO", { tipo: "conteudo", id }, { tipoPost: corpo.tipoPost, agendarEm: quando.toISOString() });
    return { status: "AGENDADO", pubStatus: "AGENDADO", agendarEm: quando.toISOString() };
  });

  /** Cancela o agendamento (ou limpa a falha): volta para APROVADO, que ainda pode ser reagendado. */
  app.post("/api/marketing/conteudos/:id/cancelar-agendamento", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const c = await carregar(req.usuario!, id, true);
    naoMexer(c);
    if (c.status !== "AGENDADO" || !["AGENDADO", "FALHOU"].includes(c.pubStatus ?? "")) throw new ErroHttp(409, "SITUACAO_INVALIDA", "Este post não está agendado.");
    await db.update(conteudos).set({ status: "APROVADO", pubStatus: null, pubErro: null, pubContainerId: null, agendarEm: null, pubTentativas: 0, pubProximaEm: null, atualizadoEm: new Date() }).where(and(eq(conteudos.id, id), sql`${conteudos.pubStatus} is distinct from 'PUBLICANDO'`));
    await auditar(db, req, "CONTEUDO_AGENDAMENTO_CANCELADO", { tipo: "conteudo", id }, {});
    return { status: "APROVADO" };
  });

  // ───────────── Banco de mídias ─────────────
  const colunasBanco = { id: bancoMidias.id, nome: bancoMidias.nome, tipo: bancoMidias.tipo, uso: bancoMidias.uso, tamanho: bancoMidias.tamanho, passeio: bancoMidias.passeio, pontoTuristico: bancoMidias.pontoTuristico, temporada: bancoMidias.temporada, criadoEm: bancoMidias.criadoEm };

  app.get("/api/marketing/banco-midias", ver, async (req) => {
    const q = z.object({ passeio: z.string().trim().max(120).optional(), pontoTuristico: z.string().trim().max(120).optional(), temporada: z.string().trim().max(60).optional(), busca: z.string().trim().max(80).optional() }).parse(req.query);
    const esc = (t: string) => t.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const itens = await db.select(colunasBanco).from(bancoMidias).where(and(
      q.passeio ? eq(bancoMidias.passeio, q.passeio) : undefined, q.pontoTuristico ? eq(bancoMidias.pontoTuristico, q.pontoTuristico) : undefined,
      q.temporada ? eq(bancoMidias.temporada, q.temporada) : undefined, q.busca ? ilike(bancoMidias.nome, `%${esc(q.busca)}%`) : undefined,
    )).orderBy(desc(bancoMidias.criadoEm)).limit(200);
    const distintos = async (col: AnyPgColumn) => (await db.selectDistinct({ v: col }).from(bancoMidias).where(sql`${col} is not null`).orderBy(col)).map((x) => String(x.v));
    const nomesPasseios = (await db.selectDistinct({ nome: passeios.nome }).from(passeios).where(eq(passeios.ativo, true)).orderBy(passeios.nome)).map((x) => x.nome);
    return {
      itens, etiquetas: { passeios: [...new Set([...nomesPasseios, ...(await distintos(bancoMidias.passeio))])], pontosTuristicos: await distintos(bancoMidias.pontoTuristico), temporadas: await distintos(bancoMidias.temporada) },
    };
  });

  app.get("/api/marketing/banco-midias/:id/arquivo", ver, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [m] = await db.select().from(bancoMidias).where(eq(bancoMidias.id, id));
    if (!m) throw naoEncontrado("Mídia");
    return entregar(reply, m);
  });

  app.patch("/api/marketing/banco-midias/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const d = z.object({
      passeio: z.string().trim().max(120).nullable().optional(), pontoTuristico: z.string().trim().max(120).nullable().optional(), temporada: z.string().trim().max(60).nullable().optional(),
      nome: z.string().trim().min(1).max(200).optional(),
    }).parse(req.body);
    const campos = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === "nome" ? v && nomeSeguro(v) : v || null]));
    const [novo] = await db.update(bancoMidias).set(campos).where(eq(bancoMidias.id, id)).returning(colunasBanco);
    if (!novo) throw naoEncontrado("Mídia");
    await auditar(db, req, "BANCO_MIDIA_EDITADA", { tipo: "banco_midia", id }, { campos: Object.keys(d) });
    return novo;
  });

  app.delete("/api/marketing/banco-midias/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const apagadas = await db.delete(bancoMidias).where(eq(bancoMidias.id, id)).returning({ id: bancoMidias.id });
    if (!apagadas.length) throw naoEncontrado("Mídia");
    await auditar(db, req, "BANCO_MIDIA_EXCLUIDA", { tipo: "banco_midia", id }, {});
    return { ok: true };
  });

  /** Copia uma mídia do banco para o post (a cópia não some se o item do banco for excluído depois). Só JPEG/MP4 servem ao Instagram. */
  app.post("/api/marketing/conteudos/:id/midias/do-banco", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { bancoId } = z.object({ bancoId: uuid }).parse(req.body);
    const c = await carregar(req.usuario!, id, true);
    naoMexer(c);
    const [b] = await db.select().from(bancoMidias).where(eq(bancoMidias.id, bancoId));
    if (!b) throw naoEncontrado("Mídia");
    if (!(TIPOS_PUBLICAVEIS as readonly string[]).includes(b.tipo)) throw new ErroHttp(400, "TIPO_INVALIDO", "O Instagram só aceita imagem JPEG e vídeo MP4. Escolha outra mídia.");
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(conteudoMidias).where(eq(conteudoMidias.conteudoId, id));
    if (n >= CARROSSEL_MAX) throw new ErroHttp(400, "MUITAS_MIDIAS", `Um post aceita no máximo ${CARROSSEL_MAX} mídias.`);
    const [nova] = await db.insert(conteudoMidias).values({ conteudoId: id, ordem: n, nome: b.nome, tipo: b.tipo, uso: b.uso, tamanho: b.tamanho, dados: b.dados, criadoPor: req.usuario!.id }).returning({ id: conteudoMidias.id });
    await perderAprovacao(c);
    await auditar(db, req, "CONTEUDO_MIDIA_DO_BANCO", { tipo: "conteudo", id }, { banco: bancoId });
    return { id: nova!.id, nome: b.nome, tipo: b.tipo, uso: b.uso, tamanho: b.tamanho, ordem: n };
  });

  // ───────────── Sugerir legenda (IA) ─────────────
  app.post("/api/marketing/legendas/sugerir", { preHandler: exigir(config, "marketing:gerenciar"), config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const d = z.object({ briefing: z.string().trim().min(3, "Conte a ideia do post.").max(800), idioma: z.enum(["pt", "en", "es"]).default("pt"), passeio: z.string().trim().max(120).optional() }).parse(req.body);
    try {
      const r = await sugerirLegendas(db, config, { briefing: d.briefing, idioma: d.idioma, passeio: d.passeio ?? null, usuarioId: req.usuario!.id });
      await auditar(db, req, "LEGENDA_SUGERIDA", undefined, { idioma: d.idioma, ligada: r.ligada });
      return r;
    } catch (e) {
      if (e instanceof ErroIA && e.codigo === "IA_LIMITE") throw new ErroHttp(429, "IA_LIMITE", "O limite mensal de gastos com IA foi atingido.");
      if (e instanceof ErroIA) throw new ErroHttp(502, "IA_ERRO", "A IA não conseguiu sugerir agora. Tente de novo em instantes.");
      throw e;
    }
  });
}
