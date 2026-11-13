import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Contexto } from "../app.js";
import { auditar } from "../auditoria.js";
import { exigir, ErroHttp } from "../seguranca/sessao.js";
import { dataIso, hojeSp } from "../servicos/marketingComum.js";
import { atualizarTempo, tempoDoPeriodo } from "../servicos/tempo.js";

/** Previsão do tempo por praça e dia (13/11/2026): ícone no calendário de saídas, na escala e no dia do passeio. */
export async function rotasTempo(app: FastifyInstance, { db, config }: Contexto) {
  app.get("/api/tempo", { preHandler: exigir(config, "manifesto:ver") }, async (req) => {
    const u = req.usuario!;
    const q = z.object({ de: dataIso, ate: dataIso, unidadeId: z.string().uuid().optional() }).parse(req.query);
    if (q.ate < q.de) throw new ErroHttp(400, "DADOS_INVALIDOS", "Período inválido.");
    if (new Date(q.ate).getTime() - new Date(q.de).getTime() > 400 * 86_400_000) throw new ErroHttp(400, "DADOS_INVALIDOS", "Período longo demais.");
    let ids: string[] | null = u.todasUnidades ? null : u.unidadeIds;
    if (q.unidadeId) ids = ids === null || ids.includes(q.unidadeId) ? [q.unidadeId] : [];
    return { porPraca: await tempoDoPeriodo(db, ids, q.de, q.ate, hojeSp()), creditos: "Previsão: MET Norway · Média histórica: NASA POWER" };
  });

  // Atualizar agora (o servidor já atualiza sozinho a cada 3 h).
  app.post("/api/tempo/atualizar", { preHandler: exigir(config, "unidades:gerenciar") }, async (req) => {
    const r = await atualizarTempo(db);
    await auditar(db, req, "TEMPO_ATUALIZADO", { tipo: "tempo", id: "todas" }, { previsoes: r.previsoes, normais: r.normais, falhas: r.falhas.length });
    return r;
  });
}
