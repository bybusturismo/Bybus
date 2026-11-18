import { DOCUMENTO_MAX_BYTES, TIPOS_ANEXO_FIN, tipoDocumentoEmpresa } from "@bybus/core";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { finLancamentoAnexos } from "../db/schema.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { garantirLancamento } from "../servicos/financeiro.js";

interface Guardas {
  ver: { preHandler: (req: FastifyRequest) => Promise<void> };
  gerenciar: { preHandler: (req: FastifyRequest) => Promise<void> };
}
const uuid = z.string().uuid();

/**
 * Boleto, nota fiscal e comprovante na conta a pagar/receber (pedido do dono, 18/11/2026). O arquivo fica cifrado no banco (mesmo
 * modelo dos anexos dos grupos). PDF e imagem abrem no navegador; o resto baixa. Quem vê o lançamento (praça) vê o anexo; quem
 * gerencia o financeiro anexa e exclui. Anexar continua permitido em conta paga ou conciliada (o comprovante vem depois).
 */
export async function rotasFinanceiroAnexos(app: FastifyInstance, { db, cofre }: Contexto, { ver, gerenciar }: Guardas) {
  app.post("/api/financeiro/lancamentos/:id/anexos", { ...gerenciar, bodyLimit: 22 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ tipo: z.enum(TIPOS_ANEXO_FIN), nome: z.string().trim().min(1).max(160), base64: z.string().min(8) }).parse(req.body);
    await garantirLancamento(db, req.usuario!, id);
    const bytes = Buffer.from(b.base64, "base64");
    if (bytes.length > DOCUMENTO_MAX_BYTES) throw new ErroHttp(400, "ARQUIVO_GRANDE", "O arquivo pode ter até 15 MB.");
    const nome = b.nome.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
    const ehXml = /\.xml$/i.test(nome) && /^\s*</.test(bytes.subarray(0, 200).toString("utf8").replace(/^﻿/, ""));
    const mime = tipoDocumentoEmpresa(bytes, nome) ?? (ehXml ? "application/xml" : null);
    if (!mime) throw new ErroHttp(400, "ARQUIVO_TIPO", "Envie PDF, JPG, PNG, XML da nota ou documento do Word/Excel.");
    const [a] = await db.insert(finLancamentoAnexos).values({
      lancamentoId: id, tipo: b.tipo, nomeArquivo: nome, mime, tamanho: bytes.length, dadosCifrados: cofre.cifrar(bytes.toString("base64")), enviadoPor: req.usuario!.id,
    }).returning({ id: finLancamentoAnexos.id, tipo: finLancamentoAnexos.tipo, nomeArquivo: finLancamentoAnexos.nomeArquivo });
    await auditar(db, req, "FIN_ANEXO_ENVIADO", { tipo: "fin_lancamento", id }, { anexoId: a!.id, tipoAnexo: b.tipo, tamanho: bytes.length });
    reply.code(201);
    return a!;
  });

  async function anexoVisivel(req: FastifyRequest, id: string) {
    const [a] = await db.select().from(finLancamentoAnexos).where(eq(finLancamentoAnexos.id, id));
    if (!a) throw new ErroHttp(404, "NAO_ENCONTRADO", "Anexo não encontrado.");
    // fora da praça de quem pede: responde como se não existisse
    await garantirLancamento(db, req.usuario!, a.lancamentoId).catch(() => { throw new ErroHttp(404, "NAO_ENCONTRADO", "Anexo não encontrado."); });
    return a;
  }

  app.get("/api/financeiro/anexos/:id", ver, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { baixar } = z.object({ baixar: z.string().optional() }).parse(req.query);
    const a = await anexoVisivel(req, id);
    const bytes = Buffer.from(cofre.decifrar(a.dadosCifrados), "base64");
    const exibir = !baixar && /^(application\/pdf|image\/(jpeg|png))$/.test(a.mime);
    await auditar(db, req, "FIN_ANEXO_ABERTO", { tipo: "fin_lancamento", id: a.lancamentoId }, { anexoId: id, tipoAnexo: a.tipo, baixou: !exibir });
    return reply.header("Content-Type", a.mime).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `${exibir ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.nomeArquivo)}`).send(bytes);
  });

  app.delete("/api/financeiro/anexos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const a = await anexoVisivel(req, id);
    await db.delete(finLancamentoAnexos).where(eq(finLancamentoAnexos.id, id));
    await auditar(db, req, "FIN_ANEXO_EXCLUIDO", { tipo: "fin_lancamento", id: a.lancamentoId }, { anexoId: id, tipoAnexo: a.tipo });
    return { ok: true };
  });
}
