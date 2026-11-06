import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TIPOS_BOTAO_BIO, corHexValida, origemDoClique } from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { bioBotoes, bioCliques } from "../db/schema.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { dataIso, gravarChave, hojeSp, lerChaves, naoEncontrado, somarDias, texto, urlHttps, uuid } from "../servicos/marketingComum.js";

const PADRAO = { titulo: "By Bus Turismo", subtitulo: "Passeios em Florianópolis e Balneário Camboriú", corPrimaria: "#007ac8", corFundo: "#f4f6f8", cupomCodigo: null as string | null, cupomTexto: null as string | null };
const cor = z.string().trim().refine(corHexValida, "Use uma cor no formato #RRGGBB");
const origemEntrada = z.string().trim().max(80).optional();

export async function rotasBio(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "marketing:ver") };
  const gerenciar = { preHandler: exigir(config, "marketing:gerenciar") };
  // Rotas públicas: sem login. Só contam agregados (sem IP, sem cookie, sem dado pessoal) e têm limite de taxa por IP.
  const publico = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

  async function lerBio() {
    const c = await lerChaves(db);
    return {
      titulo: c.get("bio_titulo") ?? PADRAO.titulo, subtitulo: c.get("bio_subtitulo") ?? PADRAO.subtitulo,
      corPrimaria: c.get("bio_cor_primaria") ?? PADRAO.corPrimaria, corFundo: c.get("bio_cor_fundo") ?? PADRAO.corFundo,
      cupomCodigo: c.get("bio_cupom_codigo") ?? null, cupomTexto: c.get("bio_cupom_texto") ?? null,
    };
  }

  /** Só quem enxerga todas as praças edita a bio (ela vale para a empresa toda). */
  function exigirTodas(todas: boolean) {
    if (!todas) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem enxerga todas as praças altera o link na bio.");
  }

  // ───────────── Página pública ─────────────

  app.get("/api/publico/bio", publico, async () => {
    const botoes = await db.select({ id: bioBotoes.id, rotulo: bioBotoes.rotulo, url: bioBotoes.url, tipo: bioBotoes.tipo, destaque: bioBotoes.destaque }).from(bioBotoes).where(eq(bioBotoes.ativo, true)).orderBy(asc(bioBotoes.ordem), asc(bioBotoes.criadoEm));
    const b = await lerBio();
    return { titulo: b.titulo, subtitulo: b.subtitulo, corPrimaria: b.corPrimaria, corFundo: b.corFundo, cupom: b.cupomCodigo ? { codigo: b.cupomCodigo, texto: b.cupomTexto } : null, botoes };
  });

  async function contar(chave: string, origem: string) {
    await db.insert(bioCliques).values({ dia: hojeSp(), chave, origem, contagem: 1 })
      .onConflictDoUpdate({ target: [bioCliques.dia, bioCliques.chave, bioCliques.origem], set: { contagem: sql`${bioCliques.contagem} + 1` } });
  }

  app.post("/api/publico/bio/visita", publico, async (req) => {
    const { origem } = z.object({ origem: origemEntrada }).parse(req.body ?? {});
    await contar("visita", origemDoClique(origem));
    return { ok: true };
  });

  app.post("/api/publico/bio/clique", publico, async (req) => {
    const c = z.object({ botaoId: uuid, origem: origemEntrada }).parse(req.body);
    const [b] = await db.select({ id: bioBotoes.id }).from(bioBotoes).where(and(eq(bioBotoes.id, c.botaoId), eq(bioBotoes.ativo, true)));
    if (!b) throw new ErroHttp(404, "NAO_ENCONTRADO", "Botão não encontrado.");
    await contar(b.id, origemDoClique(c.origem));
    return { ok: true };
  });

  // ───────────── Configuração e números (marketing:ver / marketing:gerenciar) ─────────────

  app.get("/api/marketing/bio", ver, async () => ({
    config: await lerBio(),
    botoes: await db.select().from(bioBotoes).orderBy(asc(bioBotoes.ordem), asc(bioBotoes.criadoEm)),
    caminhoPublico: "/bio",
    tipos: TIPOS_BOTAO_BIO,
  }));

  app.patch("/api/marketing/bio/config", gerenciar, async (req) => {
    exigirTodas(req.usuario!.todasUnidades);
    const c = z.object({
      titulo: texto(80).min(2).optional(), subtitulo: texto(160).optional(), corPrimaria: cor.optional(), corFundo: cor.optional(),
      cupomCodigo: z.string().trim().max(30).regex(/^[A-Za-z0-9-]*$/, "Cupom: só letras, números e hífen").nullish(), cupomTexto: texto(160).nullish(),
    }).parse(req.body);
    const mapa: Record<string, string> = { titulo: "bio_titulo", subtitulo: "bio_subtitulo", corPrimaria: "bio_cor_primaria", corFundo: "bio_cor_fundo", cupomCodigo: "bio_cupom_codigo", cupomTexto: "bio_cupom_texto" };
    for (const [k, chave] of Object.entries(mapa)) {
      const v = (c as Record<string, string | null | undefined>)[k];
      if (v !== undefined) await gravarChave(db, chave, v === null || v === "" ? null : k === "cupomCodigo" ? v.toUpperCase() : v, req.usuario!.id);
    }
    await auditar(db, req, "BIO_CONFIG_EDITADA", { tipo: "bio" }, { campos: Object.keys(c) });
    return lerBio();
  });

  const esquemaBotao = z.object({
    rotulo: texto(60).min(2), url: urlHttps, tipo: z.enum(TIPOS_BOTAO_BIO).default("OUTRO"),
    ordem: z.number().int().min(0).max(999).default(0), destaque: z.boolean().default(false), ativo: z.boolean().default(true),
  });

  app.post("/api/marketing/bio/botoes", gerenciar, async (req) => {
    exigirTodas(req.usuario!.todasUnidades);
    const c = esquemaBotao.parse(req.body);
    const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(bioBotoes);
    if ((n?.n ?? 0) >= 20) throw new ErroHttp(400, "LIMITE_BOTOES", "A página comporta no máximo 20 botões.");
    const [novo] = await db.insert(bioBotoes).values(c).returning();
    await auditar(db, req, "BIO_BOTAO_CRIADO", { tipo: "bio_botao", id: novo!.id }, { rotulo: c.rotulo, tipo: c.tipo });
    return novo;
  });

  app.patch("/api/marketing/bio/botoes/:id", gerenciar, async (req) => {
    exigirTodas(req.usuario!.todasUnidades);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const dados = esquemaBotao.partial().parse(req.body);
    const [novo] = await db.update(bioBotoes).set({ ...dados, atualizadoEm: new Date() }).where(eq(bioBotoes.id, id)).returning();
    if (!novo) throw naoEncontrado("Botão");
    await auditar(db, req, "BIO_BOTAO_EDITADO", { tipo: "bio_botao", id }, { campos: Object.keys(dados) });
    return novo;
  });

  app.delete("/api/marketing/bio/botoes/:id", gerenciar, async (req) => {
    exigirTodas(req.usuario!.todasUnidades);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [b] = await db.delete(bioBotoes).where(eq(bioBotoes.id, id)).returning();
    if (!b) throw naoEncontrado("Botão");
    await db.delete(bioCliques).where(eq(bioCliques.chave, id));
    await auditar(db, req, "BIO_BOTAO_EXCLUIDO", { tipo: "bio_botao", id }, { rotulo: b.rotulo });
    return { ok: true };
  });

  /** Números agregados: visitas e cliques por botão, por dia e por origem (utm_source). */
  app.get("/api/marketing/bio/cliques", ver, async (req) => {
    const q = z.object({ de: dataIso.optional(), ate: dataIso.optional() }).parse(req.query);
    const de = q.de ?? somarDias(hojeSp(), -29), ate = q.ate ?? hojeSp();
    if (de > ate) throw new ErroHttp(400, "PERIODO_INVALIDO", "A data inicial deve ser anterior à final.");
    const linhas = await db.select().from(bioCliques).where(and(gte(bioCliques.dia, de), lte(bioCliques.dia, ate))).orderBy(desc(bioCliques.dia));
    const botoes = await db.select({ id: bioBotoes.id, rotulo: bioBotoes.rotulo }).from(bioBotoes);
    const soma = (f: (l: (typeof linhas)[number]) => boolean) => linhas.filter(f).reduce((s, l) => s + l.contagem, 0);
    const visitas = soma((l) => l.chave === "visita"), cliques = soma((l) => l.chave !== "visita");
    const dias = new Map<string, { dia: string; visitas: number; cliques: number }>();
    const origens = new Map<string, { origem: string; visitas: number; cliques: number }>();
    for (const l of linhas) {
      const d = dias.get(l.dia) ?? { dia: l.dia, visitas: 0, cliques: 0 };
      const o = origens.get(l.origem) ?? { origem: l.origem, visitas: 0, cliques: 0 };
      if (l.chave === "visita") { d.visitas += l.contagem; o.visitas += l.contagem; } else { d.cliques += l.contagem; o.cliques += l.contagem; }
      dias.set(l.dia, d); origens.set(l.origem, o);
    }
    return {
      periodo: { de, ate }, visitas, cliques, taxaCliquePorVisita: visitas ? Math.round((cliques / visitas) * 1000) / 10 : null,
      porBotao: botoes.map((b) => ({ id: b.id, rotulo: b.rotulo, cliques: soma((l) => l.chave === b.id) })).sort((a, b) => b.cliques - a.cliques),
      porDia: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
      porOrigem: [...origens.values()].sort((a, b) => b.cliques + b.visitas - (a.cliques + a.visitas)),
    };
  });
}
