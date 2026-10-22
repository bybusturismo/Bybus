import type { FastifyInstance } from "fastify";
import { lerCsvPaytour, lerEmailBokun } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { importarReservas } from "../servicos/importacao.js";

export async function rotasImportacao(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const pre = { preHandler: exigir(config, "importacoes:executar") };

  /** Cola o texto de um ou mais e-mails "New booking"/"Cancelled booking" da Bókun (separados por linha "-----"). */
  app.post("/api/importacoes/bokun-email", pre, async (req) => {
    const corpo = z.object({
      emails: z.array(z.object({ assunto: z.string().max(500).default(""), corpo: z.string().max(100_000) })).min(1).max(200),
      confirmar: z.boolean().default(false),
    }).parse(req.body);
    const lidos = corpo.emails.map((e) => lerEmailBokun(e.assunto, e.corpo));
    const validos = lidos.filter((r): r is NonNullable<typeof r> => r !== null);
    if (validos.length === 0) throw new ErroHttp(400, "NADA_RECONHECIDO", "Nenhum e-mail de reserva da Bókun foi reconhecido.");
    const r = await importarReservas(db, cofre, validos, { confirmar: corpo.confirmar, origem: "BOKUN_EMAIL", usuario: req.usuario!, anonimizar: config.AMBIENTE !== "producao" });
    if (corpo.confirmar) await auditar(db, req, "IMPORTACAO_BOKUN", { tipo: "importacao" }, r.resumo);
    return { ...r, naoReconhecidos: lidos.length - validos.length };
  });

  app.post("/api/importacoes/paytour-csv", { ...pre, bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const corpo = z.object({
      conteudo: z.string().max(5_000_000),
      confirmar: z.boolean().default(false),
      passeioCodigo: z.string().max(40).default("TODA_ILHA"),
    }).parse(req.body);
    const lido = lerCsvPaytour(corpo.conteudo);
    if (lido.reservas.length === 0) throw new ErroHttp(400, "CSV_INVALIDO", lido.erros.map((e) => `Linha ${e.linha}: ${e.mensagem}`).join(" ") || "Nenhuma reserva encontrada.");
    const r = await importarReservas(db, cofre, lido.reservas, { confirmar: corpo.confirmar, passeioCodigo: corpo.passeioCodigo, origem: "PAYTOUR_CSV", usuario: req.usuario!, anonimizar: config.AMBIENTE !== "producao" });
    if (corpo.confirmar) await auditar(db, req, "IMPORTACAO_PAYTOUR", { tipo: "importacao" }, r.resumo);
    return { ...r, errosLeitura: lido.erros, colunasNaoEncontradas: lido.colunasNaoEncontradas };
  });
}
