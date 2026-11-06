import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { periodoDoRelatorio } from "@bybus/core";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { relatoriosMarketing, unidades } from "../db/schema.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";
import { gerarRelatorios } from "../servicos/relatoriosMarketing.js";
import { dataIso, hojeSp, naoEncontrado, uuid } from "../servicos/marketingComum.js";
import { iaConfigurada } from "../servicos/ia/cliente.js";

export async function rotasRelatoriosMkt(app: FastifyInstance, { db, config }: Contexto) {
  const ver = { preHandler: exigir(config, "marketing:ver") };
  const gerenciar = { preHandler: exigir(config, "marketing:gerenciar") };

  /** Consolidado (todas as praças) só para quem enxerga todas; os demais veem o relatório das suas praças. */
  const visiveis = (u: UsuarioSessao) => (u.todasUnidades ? undefined : u.unidadeIds.length ? and(isNotNull(relatoriosMarketing.unidadeId), inArray(relatoriosMarketing.unidadeId, u.unidadeIds)) : eq(relatoriosMarketing.id, "00000000-0000-0000-0000-000000000000"));

  app.get("/api/marketing/relatorios", ver, async (req) => {
    const q = z.object({ tipo: z.enum(["SEMANAL", "MENSAL"]).optional() }).parse(req.query);
    const lista = await db.select({ r: relatoriosMarketing, praca: unidades.nome }).from(relatoriosMarketing).leftJoin(unidades, eq(unidades.id, relatoriosMarketing.unidadeId))
      .where(and(visiveis(req.usuario!), q.tipo ? eq(relatoriosMarketing.tipo, q.tipo) : undefined)).orderBy(desc(relatoriosMarketing.de), desc(relatoriosMarketing.geradoEm)).limit(200);
    return {
      iaLigada: iaConfigurada(config),
      relatorios: lista.map(({ r, praca }) => ({ id: r.id, tipo: r.tipo, de: r.de, ate: r.ate, unidadeId: r.unidadeId, praca: praca ?? "Todas as praças", geradoEm: r.geradoEm, automatico: r.geradoPor == null, temResumoIa: !!r.resumoIa })),
    };
  });

  app.get("/api/marketing/relatorios/:id", ver, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [x] = await db.select({ r: relatoriosMarketing, praca: unidades.nome }).from(relatoriosMarketing).leftJoin(unidades, eq(unidades.id, relatoriosMarketing.unidadeId))
      .where(and(eq(relatoriosMarketing.id, id), visiveis(req.usuario!)));
    if (!x) throw naoEncontrado("Relatório");
    const { r } = x;
    return { id: r.id, tipo: r.tipo, de: r.de, ate: r.ate, unidadeId: r.unidadeId, praca: x.praca ?? "Todas as praças", geradoEm: r.geradoEm, automatico: r.geradoPor == null, dados: r.dados, resumoNumeros: r.resumoNumeros, resumoIa: r.resumoIa };
  });

  /** Gera agora o último período fechado (ou o da data de referência). Já existente: só refaz com `regenerar`. */
  app.post("/api/marketing/relatorios/gerar", gerenciar, async (req) => {
    const c = z.object({ tipo: z.enum(["SEMANAL", "MENSAL"]), referencia: dataIso.optional(), regenerar: z.boolean().default(false) }).parse(req.body);
    const referencia = c.referencia ?? hojeSp();
    if (referencia > hojeSp()) throw new ErroHttp(400, "DATA_FUTURA", "A data de referência não pode ser futura.");
    const per = periodoDoRelatorio(c.tipo, referencia);
    const ids = await gerarRelatorios(db, config, c.tipo, referencia, { geradoPor: req.usuario!.id, regenerar: c.regenerar });
    await auditar(db, req, "RELATORIO_MARKETING_GERADO", { tipo: "relatorio_marketing" }, { tipo: c.tipo, de: per.de, ate: per.ate, gerados: ids.length, regenerar: c.regenerar });
    return { gerados: ids.length, periodo: { de: per.de, ate: per.ate, rotulo: per.rotulo } };
  });
}
