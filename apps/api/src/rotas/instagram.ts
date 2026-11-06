import { createHmac, timingSafeEqual } from "node:crypto";
import { dataSaoPaulo, engajamentoDoPost, melhoresHorarios, rankingPosts } from "@bybus/core";
import { and, asc, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { conteudoMidias, conteudos, igComentarios, igMetricasDia, igMidiaTokens, igPosts } from "../db/schema.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { estadoInstagram, instagramReal, ocultarComentario, responderComentario } from "../servicos/instagram/cliente.js";
import { sincronizarInstagram } from "../servicos/instagram/dados.js";
import { processarAvisoInstagram } from "../servicos/instagram/entrada.js";
import { hashToken } from "../servicos/instagram/publicacao.js";
import { hash as hashCurto } from "../servicos/instagram/util.js";

const uuid = z.string().uuid();
const naoEncontrado = () => new ErroHttp(404, "NAO_ENCONTRADO", "Não encontrado.");
const iguais = (a: string, b: string) => timingSafeEqual(hashCurto(a), hashCurto(b));

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD");
function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function rotasInstagram(app: FastifyInstance, { db, config }: Contexto) {
  // ---------- Aviso (webhook) da Meta: público na internet, protegido por token de verificação (GET) e assinatura HMAC (POST) ----------
  await app.register(async (aviso) => {
    // A assinatura é calculada sobre os BYTES exatos do corpo: guardamos o corpo cru antes de converter para JSON.
    aviso.removeContentTypeParser("application/json");
    aviso.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 1024 * 1024 }, (_req, corpo, feito) => feito(null, corpo));

    // Verificação do endereço: a Meta chama GET com hub.mode, hub.verify_token e hub.challenge e espera o challenge de volta.
    aviso.get("/api/webhooks/instagram", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
      const esperado = config.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
      if (!esperado) return reply.status(404).send({ codigo: "NAO_ENCONTRADO", mensagem: "Não encontrado." });
      const q = req.query as Record<string, unknown>;
      const desafio = typeof q["hub.challenge"] === "string" ? q["hub.challenge"] : "";
      if (q["hub.mode"] !== "subscribe" || typeof q["hub.verify_token"] !== "string" || !iguais(q["hub.verify_token"], esperado) || !/^[\w-]{1,100}$/.test(desafio)) {
        return reply.status(403).send({ codigo: "RECUSADO", mensagem: "Verificação recusada." });
      }
      return reply.type("text/plain").send(desafio);
    });

    // Recebimento: sem o segredo do app a rota não existe (404); assinatura ausente ou errada → 401. Nunca registra o corpo.
    aviso.post("/api/webhooks/instagram", { bodyLimit: 1024 * 1024, config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
      const segredo = config.INSTAGRAM_APP_SECRET;
      if (!segredo) return reply.status(404).send({ codigo: "NAO_ENCONTRADO", mensagem: "Não encontrado." });
      const cru = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const recebida = String(req.headers["x-hub-signature-256"] ?? "");
      const calculada = `sha256=${createHmac("sha256", segredo).update(cru).digest("hex")}`;
      if (!recebida || !iguais(recebida, calculada)) return reply.status(401).send({ codigo: "ASSINATURA_INVALIDA", mensagem: "Assinatura inválida." });
      let corpo: unknown;
      try { corpo = JSON.parse(cru.toString("utf8")); } catch { return reply.status(400).send({ codigo: "CORPO_INVALIDO", mensagem: "Corpo inválido." }); }
      await processarAvisoInstagram(db, config, corpo);
      return { ok: true };
    });
  });

  // ---------- Mídia agendada: endereço público de curta duração (a Meta precisa buscar o arquivo) ----------
  // Revisão de segurança em docs/produto/modulo-instagram.md: o token (32 bytes aleatórios) vale para UMA mídia, só existe enquanto o
  // post está sendo publicado, expira em 30 min e só o hash fica no banco. Token desconhecido, expirado ou de post que não está
  // publicando: sempre o mesmo 404, sem dizer o motivo.
  app.get("/api/publico/instagram/midia/:token", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { token } = req.params as { token: string };
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw naoEncontrado();
    const [m] = await db.select({ tipo: conteudoMidias.tipo, dados: conteudoMidias.dados, nome: conteudoMidias.nome })
      .from(igMidiaTokens).innerJoin(conteudoMidias, eq(conteudoMidias.id, igMidiaTokens.midiaId)).innerJoin(conteudos, eq(conteudos.id, conteudoMidias.conteudoId))
      .where(and(eq(igMidiaTokens.tokenHash, hashToken(token)), gt(igMidiaTokens.expiraEm, new Date()), eq(conteudos.pubStatus, "PUBLICANDO")));
    if (!m) throw naoEncontrado();
    return reply.header("Content-Type", m.tipo).header("Content-Length", m.dados.length).header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff").header("Content-Disposition", "inline").send(m.dados);
  });

  // ---------- Comentários dos posts (painel dentro de Conversas) ----------
  const ver = { preHandler: exigir(config, "whatsapp:ver") };
  const responder = (max: number) => ({ preHandler: [exigir(config, "whatsapp:ver"), exigir(config, "whatsapp:responder")], config: { rateLimit: { max, timeWindow: "1 minute" } } });

  app.get("/api/instagram/comentarios", ver, async (req) => {
    const q = z.object({ situacao: z.enum(["pendentes", "todos"]).default("pendentes"), limite: z.coerce.number().int().min(1).max(200).default(100) }).parse(req.query);
    const linhas = await db.select({
      c: igComentarios, legendaPost: igPosts.legenda, linkPost: igPosts.link,
    }).from(igComentarios).leftJoin(igPosts, eq(igPosts.idExterno, igComentarios.midiaId))
      .where(q.situacao === "pendentes" ? and(sql`${igComentarios.respostaStatus} is null`, eq(igComentarios.oculto, false)) : undefined)
      .orderBy(desc(igComentarios.criadoEm)).limit(q.limite);
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(igComentarios).where(eq(igComentarios.lido, false));
    return {
      modo: estadoInstagram(config), naoLidos: n,
      comentarios: linhas.map(({ c, legendaPost, linkPost }) => ({
        id: c.id, autor: c.autorUsuario, texto: c.texto, escritoEm: c.escritoEm ?? c.criadoEm, ehResposta: c.paiIdExterno !== null, oculto: c.oculto, lido: c.lido,
        respostaTexto: c.respostaTexto, respostaStatus: c.respostaStatus, respostaEm: c.respostaEm,
        post: c.midiaId ? { legenda: legendaPost?.slice(0, 120) ?? null, link: linkPost ?? null } : null,
      })),
    };
  });

  async function comentario(id: string) {
    const [c] = await db.select().from(igComentarios).where(eq(igComentarios.id, id));
    if (!c) throw new ErroHttp(404, "NAO_ENCONTRADO", "Comentário não encontrado.");
    return c;
  }

  app.post("/api/instagram/comentarios/:id/lido", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await comentario(id);
    await db.update(igComentarios).set({ lido: true }).where(eq(igComentarios.id, id));
    return { ok: true };
  });

  app.post("/api/instagram/comentarios/:id/responder", responder(30), async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { texto } = z.object({ texto: z.string().trim().min(1, "Escreva a resposta.").max(2200, "A resposta pode ter até 2.200 caracteres.") }).parse(req.body);
    const c = await comentario(id);
    // Só comentário de primeiro nível recebe resposta pública (a CONFIRMAR na doc oficial).
    if (c.paiIdExterno) throw new ErroHttp(400, "SO_PRIMEIRO_NIVEL", "Só é possível responder comentários de primeiro nível.");
    if (c.respostaStatus === "ENVIADA" || c.respostaStatus === "SIMULADA") throw new ErroHttp(409, "JA_RESPONDIDO", "Este comentário já foi respondido.");
    let status: "ENVIADA" | "SIMULADA" | "FALHA" = "SIMULADA";
    let idExterno: string | null = null;
    let erro: string | null = null;
    if (instagramReal(config)) {
      const r = await responderComentario(config, c.idExterno, texto);
      status = r.ok ? "ENVIADA" : "FALHA";
      idExterno = r.dados?.id ?? null;
      erro = r.ok ? null : `META_${r.codigo ?? r.status}`;
    }
    await db.update(igComentarios).set({ respostaTexto: texto, respostaStatus: status, respostaIdExterno: idExterno, respostaPor: req.usuario!.id, respostaEm: new Date(), lido: true }).where(eq(igComentarios.id, id));
    await auditar(db, req, "instagram.comentario_responder", { tipo: "ig_comentario", id }, { comentarioId: id, status });
    return { status, erro };
  });

  app.post("/api/instagram/comentarios/:id/ocultar", responder(60), async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { oculto } = z.object({ oculto: z.boolean().default(true) }).parse(req.body ?? {});
    const c = await comentario(id);
    let erro: string | null = null;
    if (instagramReal(config)) {
      const r = await ocultarComentario(config, c.idExterno, oculto);
      if (!r.ok) erro = `META_${r.codigo ?? r.status}`;
    }
    if (!erro) await db.update(igComentarios).set({ oculto, lido: true }).where(eq(igComentarios.id, id));
    await auditar(db, req, oculto ? "instagram.comentario_ocultar" : "instagram.comentario_mostrar", { tipo: "ig_comentario", id }, { comentarioId: id, ok: !erro });
    if (erro) throw new ErroHttp(502, "INSTAGRAM_RECUSOU", "O Instagram não aceitou a alteração. Tente de novo em instantes.");
    return { ok: true, oculto };
  });

  // ---------- Dados no Marketing (aba Instagram) ----------
  app.get("/api/marketing/instagram", { preHandler: exigir(config, "marketing:ver") }, async (req) => {
    const q = z.object({ de: dataIso.optional(), ate: dataIso.optional() }).parse(req.query);
    const ate = q.ate ?? dataSaoPaulo(new Date());
    const de = q.de ?? somarDias(ate, -29);
    if (de > ate) throw new ErroHttp(400, "PERIODO_INVALIDO", "A data inicial deve ser anterior à final.");
    if ((Date.parse(ate) - Date.parse(de)) / 86_400_000 > 400) throw new ErroHttp(400, "PERIODO_INVALIDO", "Período longo demais (máximo de 400 dias).");
    const serie = await db.select().from(igMetricasDia).where(and(gte(igMetricasDia.data, de), lte(igMetricasDia.data, ate))).orderBy(asc(igMetricasDia.data));
    const soma = (f: (d: (typeof serie)[number]) => number | null) => serie.reduce((s, d) => s + (f(d) ?? 0), 0);
    const comSeg = serie.filter((d) => d.seguidores !== null);
    const inicio = new Date(`${de}T00:00:00-03:00`);
    const fim = new Date(`${ate}T23:59:59.999-03:00`);
    const posts = await db.select().from(igPosts).where(and(gte(igPosts.publicadoEm, inicio), lte(igPosts.publicadoEm, fim)));
    const metricas = posts.map((p) => ({ ...p, publicadoEm: p.publicadoEm }));
    const [{ ultima } = { ultima: null as Date | null }] = await db.select({ ultima: sql<Date | null>`max(${igMetricasDia.atualizadoEm})` }).from(igMetricasDia);
    return {
      modo: estadoInstagram(config), periodo: { de, ate }, atualizadoEm: ultima,
      resumo: {
        seguidores: comSeg.length ? comSeg[comSeg.length - 1]!.seguidores : null,
        variacaoSeguidores: comSeg.length >= 2 ? comSeg[comSeg.length - 1]!.seguidores! - comSeg[0]!.seguidores! : null,
        alcance: soma((d) => d.alcance), visualizacoes: soma((d) => d.visualizacoes), visitasPerfil: soma((d) => d.visitasPerfil), cliquesSite: soma((d) => d.cliquesSite),
        posts: posts.length, engajamento: posts.reduce((s, p) => s + engajamentoDoPost(p), 0),
      },
      serie: serie.map((d) => ({ data: d.data, seguidores: d.seguidores, alcance: d.alcance })),
      ranking: rankingPosts(metricas, 10).map((p) => ({ id: p.id, tipo: p.tipo, legenda: p.legenda?.slice(0, 140) ?? null, link: p.link, publicadoEm: p.publicadoEm, curtidas: p.curtidas, comentarios: p.comentarios, salvamentos: p.salvamentos, compartilhamentos: p.compartilhamentos, alcance: p.alcance, engajamento: p.engajamento, taxa: p.taxa })),
      melhores: melhoresHorarios(metricas),
    };
  });

  app.post("/api/marketing/instagram/atualizar", { preHandler: exigir(config, "marketing:gerenciar"), config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req) => {
    const r = await sincronizarInstagram(db, config);
    await auditar(db, req, "instagram.atualizar_dados", undefined, { executou: r.executou, dias: r.dias, posts: r.posts, falhas: r.falhas.length });
    return r;
  });
}
