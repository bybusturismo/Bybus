import { CANAIS_AVALIACAO_ONLINE, resumirAvaliacoes } from "@bybus/core";
import { and, desc, eq, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { avaliacoesOnline } from "../db/schema.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import {
  concluirConexaoGoogle, desconectarGoogle, googleConectado, googleConfigurado, listarLocaisGoogle, locaisPorPraca, responderGoogle, salvarLocais,
  sincronizarAvaliacoes, tripadvisorConfigurado, ultimaSincronia, urlConectarGoogle, urlRetornoGoogle,
} from "../servicos/avaliacoesOnline.js";
import { visivel } from "../servicos/marketingComum.js";

/**
 * Marketing → Avaliações do Google e do Tripadvisor (dono, 18/11/2026). Quem vê o marketing lê; quem gerencia conecta o Google,
 * escolhe os locais, atualiza na hora e responde as avaliações do Google. Tudo por praça.
 */
export async function rotasAvaliacoesOnline(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const ver = { preHandler: exigir(config, "marketing:ver") };
  const gerenciar = { preHandler: exigir(config, "marketing:gerenciar") };

  app.get("/api/marketing/avaliacoes-online", ver, async (req) => {
    const u = req.usuario!;
    const q = z.object({
      unidadeId: z.string().uuid().optional(), canal: z.enum(CANAIS_AVALIACAO_ONLINE).optional(),
      notaAte: z.coerce.number().int().min(1).max(5).optional(), situacao: z.enum(["todas", "novas", "sem_resposta"]).default("todas"),
      limite: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);
    if (q.unidadeId && !podeUnidade(u, q.unidadeId)) throw new ErroHttp(404, "NAO_ENCONTRADO", "Praça não encontrada.");
    const base: SQL[] = [visivel(u, avaliacoesOnline.unidadeId) ?? sql`true`];
    if (q.unidadeId) base.push(eq(avaliacoesOnline.unidadeId, q.unidadeId));
    const filtro = and(...base,
      q.canal ? eq(avaliacoesOnline.canal, q.canal) : undefined,
      q.notaAte ? lte(avaliacoesOnline.nota, q.notaAte) : undefined,
      q.situacao === "novas" ? eq(avaliacoesOnline.lida, false) : undefined,
      q.situacao === "sem_resposta" ? isNull(avaliacoesOnline.resposta) : undefined);
    const itens = await db.select().from(avaliacoesOnline).where(filtro).orderBy(desc(avaliacoesOnline.publicadaEm), desc(avaliacoesOnline.criadoEm)).limit(q.limite);
    // resumo por praça e canal: nota e total oficiais (da última leitura) + o que está guardado aqui
    const guardadas = await db.select({ unidadeId: avaliacoesOnline.unidadeId, canal: avaliacoesOnline.canal, nota: avaliacoesOnline.nota, resposta: avaliacoesOnline.resposta, lida: avaliacoesOnline.lida })
      .from(avaliacoesOnline).where(and(...base));
    const sinc = await ultimaSincronia(db);
    const locais = await locaisPorPraca(db);
    const resumo = Object.entries(locais).filter(([id]) => podeUnidade(u, id) && (!q.unidadeId || q.unidadeId === id)).flatMap(([unidadeId, l]) => CANAIS_AVALIACAO_ONLINE.map((canal) => {
      const doGrupo = guardadas.filter((g) => g.unidadeId === unidadeId && g.canal === canal);
      const oficial = sinc?.resultados.find((r) => r.unidadeId === unidadeId && r.canal === canal) ?? null;
      return {
        unidadeId, praca: l.nome, canal, configurado: canal === "GOOGLE" ? !!l.google : !!l.tripadvisor,
        media: oficial?.media ?? null, total: oficial?.total ?? null, link: oficial?.link ?? null, selo: oficial?.selo ?? null, erro: oficial && !oficial.ok ? oficial.erro : null,
        guardadas: resumirAvaliacoes(doGrupo), novas: doGrupo.filter((g) => !g.lida).length,
      };
    }));
    return {
      estado: {
        google: { configurado: googleConfigurado(config), conectado: await googleConectado(db), retorno: urlRetornoGoogle(config) },
        tripadvisor: { configurado: tripadvisorConfigurado(config) },
      },
      ultima: sinc ? { em: sinc.em } : null, locais, resumo, itens,
    };
  });

  app.post("/api/marketing/avaliacoes-online/atualizar", { ...gerenciar, config: { rateLimit: { max: 6, timeWindow: "10 minutes" } } }, async (req) => {
    if (!googleConfigurado(config) && !tripadvisorConfigurado(config)) throw new ErroHttp(400, "NADA_LIGADO", "Nem o Google nem o Tripadvisor foram ligados no servidor ainda.");
    const s = await sincronizarAvaliacoes(db, config, cofre);
    await auditar(db, req, "AVALIACOES_ONLINE_ATUALIZADAS", { tipo: "avaliacoes_online" }, { resultados: s.resultados.map((r) => ({ canal: r.canal, ok: r.ok, novas: r.novas ?? 0 })) });
    return s;
  });

  app.post("/api/marketing/avaliacoes-online/lidas", ver, async (req) => {
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
    await db.update(avaliacoesOnline).set({ lida: true }).where(and(inArray(avaliacoesOnline.id, ids), visivel(req.usuario!, avaliacoesOnline.unidadeId)));
    return { ok: true };
  });

  app.post("/api/marketing/avaliacoes-online/:id/responder", gerenciar, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { texto } = z.object({ texto: z.string().trim().min(2).max(4000) }).parse(req.body);
    const [a] = await db.select({ unidadeId: avaliacoesOnline.unidadeId }).from(avaliacoesOnline).where(and(eq(avaliacoesOnline.id, id), visivel(req.usuario!, avaliacoesOnline.unidadeId)));
    if (!a) throw new ErroHttp(404, "NAO_ENCONTRADO", "Avaliação não encontrada.");
    const r = await responderGoogle(db, config, cofre, id, texto);
    await auditar(db, req, "AVALIACAO_GOOGLE_RESPONDIDA", { tipo: "avaliacao_online", id }, { tamanho: texto.length });
    return r;
  });

  // ---------- conexão com o Google e locais ----------
  app.get("/api/marketing/google/conectar", gerenciar, async (req) => ({ url: urlConectarGoogle(config, req.usuario!.id) }));

  /** Volta do Google (o navegador da pessoa, com a sessão dela). Conclui e devolve para a tela. */
  app.get("/api/marketing/google/retorno", gerenciar, async (req, reply) => {
    const q = z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }).parse(req.query);
    if (q.error || !q.code || !q.state) return reply.redirect("/marketing/avaliacoes-online?google=cancelado");
    try {
      await concluirConexaoGoogle(db, config, cofre, req.usuario!.id, q.code, q.state);
      await auditar(db, req, "GOOGLE_PERFIL_CONECTADO", { tipo: "configuracao" }, {});
      return reply.redirect("/marketing/avaliacoes-online?google=conectado");
    } catch {
      return reply.redirect("/marketing/avaliacoes-online?google=erro");
    }
  });
  app.delete("/api/marketing/google/conexao", gerenciar, async (req) => {
    await desconectarGoogle(db);
    await auditar(db, req, "GOOGLE_PERFIL_DESCONECTADO", { tipo: "configuracao" }, {});
    return { ok: true };
  });
  app.get("/api/marketing/google/locais", gerenciar, async () => listarLocaisGoogle(db, config, cofre));
  app.put("/api/marketing/avaliacoes-online/locais", gerenciar, async (req) => {
    const c = z.record(z.string().uuid(), z.object({ google: z.string().nullish(), tripadvisor: z.string().nullish() })).parse(req.body);
    await salvarLocais(db, c, req.usuario!.id);
    await auditar(db, req, "AVALIACOES_ONLINE_LOCAIS", { tipo: "configuracao" }, { pracas: Object.keys(c).length });
    return locaisPorPraca(db);
  });
}
