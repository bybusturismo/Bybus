import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { carregarManifesto, manifestoCsv } from "../servicos/manifesto.js";

export async function rotasManifesto(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const parametros = (req: { params: unknown; query: unknown; usuario?: { perfil: Parameters<typeof pode>[0] } }) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { documentos } = z.object({ documentos: z.enum(["mascarados", "completos"]).default("mascarados") }).parse(req.query);
    const perfil = req.usuario!.perfil;
    if (documentos === "completos" && !pode(perfil, "manifesto:documentos")) {
      throw new ErroHttp(403, "SEM_PERMISSAO", "Seu perfil não pode ver documentos completos.");
    }
    return { id, opcoes: { documentosCompletos: documentos === "completos", mostrarContatos: pode(perfil, "manifesto:contatos") } };
  };

  app.get("/api/saidas/:id/manifesto", { preHandler: exigir(config, "manifesto:ver") }, async (req) => {
    const { id, opcoes } = parametros(req);
    const resultado = await carregarManifesto(db, cofre, id, opcoes);
    await auditar(db, req, opcoes.documentosCompletos ? "MANIFESTO_DOCUMENTOS_COMPLETOS" : "MANIFESTO_VISUALIZADO", { tipo: "saida", id });
    return resultado;
  });

  app.get("/api/saidas/:id/manifesto.csv", { preHandler: exigir(config, "manifesto:ver") }, async (req, reply) => {
    const { id, opcoes } = parametros(req);
    const { saida, manifesto } = await carregarManifesto(db, cofre, id, opcoes);
    await auditar(db, req, "MANIFESTO_EXPORTADO", { tipo: "saida", id }, { documentos: opcoes.documentosCompletos ? "completos" : "mascarados" });
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="lista-passageiros-${saida.data}.csv"`);
    reply.header("Cache-Control", "no-store");
    return manifestoCsv(manifesto);
  });
}
