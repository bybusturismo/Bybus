import { ANTECEDENCIA_VENCIMENTO_DOC_DIAS, DOCUMENTO_MAX_BYTES, podeVerPasta, situacaoVencimento, tipoDocumentoEmpresa, type AcessoPasta } from "@bybus/core";
import { and, asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { docArquivos, docPastas, perfis, usuarios } from "../db/schema.js";
import { pode } from "../seguranca/permissoes.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";

/**
 * Documentos da empresa (pedido do dono, 11/11/2026). Pasta restrita: só administrador + perfis/pessoas da lista; quem não vê a pasta
 * recebe 404 (não fica sabendo que o documento existe). Acesso das pastas: só o administrador muda. Arquivos cifrados; abrir é auditado.
 */
const uuid = z.string().uuid();
const hojeSp = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const ehAdmin = (u: UsuarioSessao) => u.perfil === "ADMIN";

export async function rotasDocumentos(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const ver = { preHandler: exigir(config, "documentos:ver") };
  const gerenciar = { preHandler: exigir(config, "documentos:gerenciar") };
  const quem = (req: FastifyRequest) => ({ id: req.usuario!.id, perfil: req.usuario!.perfil });

  async function pastaVisivel(req: FastifyRequest, id: string) {
    const [p] = await db.select().from(docPastas).where(eq(docPastas.id, id));
    if (!p || !podeVerPasta({ acesso: p.acesso as AcessoPasta, perfis: p.perfis, usuarios: p.usuarios }, quem(req))) throw new ErroHttp(404, "NAO_ENCONTRADO", "Pasta não encontrada.");
    return p;
  }
  async function arquivoVisivel(req: FastifyRequest, id: string) {
    const [a] = await db.select().from(docArquivos).where(and(eq(docArquivos.id, id), eq(docArquivos.ativo, true)));
    if (!a) throw new ErroHttp(404, "NAO_ENCONTRADO", "Documento não encontrado.");
    await pastaVisivel(req, a.pastaId);
    return a;
  }

  const resumoArquivo = (a: typeof docArquivos.$inferSelect & { enviadoPorNome?: string | null }, hoje: string) => ({
    id: a.id, pastaId: a.pastaId, titulo: a.titulo, descricao: a.descricao, nomeArquivo: a.nomeArquivo, mime: a.mime, tamanho: a.tamanho,
    vencimento: a.vencimento, situacao: a.vencimento ? situacaoVencimento(a.vencimento, hoje, ANTECEDENCIA_VENCIMENTO_DOC_DIAS) : null,
    enviadoPor: a.enviadoPorNome ?? null, criadoEm: a.criadoEm,
  });

  /** Pastas que a pessoa vê, com a contagem e os vencimentos próximos. */
  app.get("/api/documentos", ver, async (req) => {
    const hoje = hojeSp();
    const pastas = (await db.select().from(docPastas).orderBy(asc(docPastas.ordem), asc(docPastas.nome)))
      .filter((p) => podeVerPasta({ acesso: p.acesso as AcessoPasta, perfis: p.perfis, usuarios: p.usuarios }, quem(req)));
    const ids = new Set(pastas.map((p) => p.id));
    const arquivos = (await db.select({ a: docArquivos, enviadoPorNome: usuarios.nome }).from(docArquivos).leftJoin(usuarios, eq(usuarios.id, docArquivos.enviadoPor))
      .where(eq(docArquivos.ativo, true)).orderBy(asc(docArquivos.titulo)))
      .filter((x) => ids.has(x.a.pastaId)).map((x) => resumoArquivo({ ...x.a, enviadoPorNome: x.enviadoPorNome }, hoje));
    const admin = ehAdmin(req.usuario!);
    return {
      podeGerenciar: pode(req.usuario!, "documentos:gerenciar"),
      podeDefinirAcesso: admin,
      pastas: pastas.map((p) => ({
        id: p.id, nome: p.nome, descricao: p.descricao, acesso: p.acesso,
        // Quem está na lista só aparece para o administrador.
        ...(admin ? { perfis: p.perfis, usuarios: p.usuarios } : {}),
        arquivos: arquivos.filter((a) => a.pastaId === p.id).length,
      })),
      arquivos,
      alertas: arquivos.filter((a) => a.situacao === "VENCIDO" || a.situacao === "A_VENCER"),
    };
  });

  // ---------- Pastas ----------
  const corpoPasta = z.object({
    nome: z.string().trim().min(2).max(80),
    descricao: z.string().trim().max(300).nullish().transform((v) => v || null),
    acesso: z.enum(["TODOS", "RESTRITO"]).default("TODOS"),
    perfis: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
    usuarios: z.array(uuid).max(200).default([]),
  });

  app.post("/api/documentos/pastas", gerenciar, async (req, reply) => {
    const c = corpoPasta.parse(req.body);
    // Quem não é administrador cria pasta aberta (o acesso restrito é decisão do administrador).
    const acesso = ehAdmin(req.usuario!) ? c : { ...c, acesso: "TODOS" as const, perfis: [], usuarios: [] };
    const [p] = await db.insert(docPastas).values({ nome: acesso.nome, descricao: acesso.descricao, acesso: acesso.acesso, perfis: acesso.perfis, usuarios: acesso.usuarios }).returning();
    await auditar(db, req, "DOC_PASTA_CRIADA", { tipo: "doc_pasta", id: p!.id }, { nome: p!.nome, acesso: p!.acesso });
    reply.code(201);
    return { id: p!.id };
  });

  app.patch("/api/documentos/pastas/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const antes = await pastaVisivel(req, id);
    const c = corpoPasta.partial().parse(req.body);
    const mudaAcesso = c.acesso !== undefined || c.perfis !== undefined || c.usuarios !== undefined;
    if (mudaAcesso && !ehAdmin(req.usuario!)) throw new ErroHttp(403, "SEM_PERMISSAO", "Só o administrador muda quem vê a pasta.");
    await db.update(docPastas).set({
      ...(c.nome ? { nome: c.nome } : {}), ...(c.descricao !== undefined ? { descricao: c.descricao } : {}),
      ...(c.acesso ? { acesso: c.acesso } : {}), ...(c.perfis ? { perfis: c.perfis } : {}), ...(c.usuarios ? { usuarios: c.usuarios } : {}),
    }).where(eq(docPastas.id, id));
    await auditar(db, req, mudaAcesso ? "DOC_PASTA_ACESSO" : "DOC_PASTA_ALTERADA", { tipo: "doc_pasta", id }, {
      nome: c.nome ?? antes.nome, ...(mudaAcesso ? { antes: { acesso: antes.acesso, perfis: antes.perfis, usuarios: antes.usuarios.length }, depois: { acesso: c.acesso ?? antes.acesso, perfis: c.perfis ?? antes.perfis, usuarios: (c.usuarios ?? antes.usuarios).length } } : {}),
    });
    return { ok: true };
  });

  app.delete("/api/documentos/pastas/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const p = await pastaVisivel(req, id);
    const [n] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(docArquivos).where(eq(docArquivos.pastaId, id));
    if ((n?.n ?? 0) > 0) throw new ErroHttp(409, "PASTA_COM_DOCUMENTOS", "A pasta tem documentos. Mova ou apague os documentos antes.");
    await db.delete(docPastas).where(eq(docPastas.id, id));
    await auditar(db, req, "DOC_PASTA_EXCLUIDA", { tipo: "doc_pasta", id }, { nome: p.nome });
    return { ok: true };
  });

  // ---------- Arquivos ----------
  app.post("/api/documentos/arquivos", { ...gerenciar, bodyLimit: 22 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z.object({
      pastaId: uuid,
      titulo: z.string().trim().min(2).max(160),
      descricao: z.string().trim().max(500).nullish().transform((v) => v || null),
      vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v || null),
      nome: z.string().trim().min(1).max(160),
      base64: z.string().min(8),
    }).parse(req.body);
    await pastaVisivel(req, b.pastaId);
    const bytes = Buffer.from(b.base64, "base64");
    if (bytes.length > DOCUMENTO_MAX_BYTES) throw new ErroHttp(400, "ARQUIVO_GRANDE", "O arquivo pode ter até 15 MB.");
    const nome = b.nome.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
    const mime = tipoDocumentoEmpresa(bytes, nome);
    if (!mime) throw new ErroHttp(400, "ARQUIVO_TIPO", "Envie PDF, JPG, PNG ou documento do Word, Excel ou PowerPoint.");
    const [a] = await db.insert(docArquivos).values({
      pastaId: b.pastaId, titulo: b.titulo, descricao: b.descricao, vencimento: b.vencimento, nomeArquivo: nome, mime, tamanho: bytes.length,
      dadosCifrados: cofre.cifrar(bytes.toString("base64")), enviadoPor: req.usuario!.id,
    }).returning({ id: docArquivos.id });
    await auditar(db, req, "DOC_ENVIADO", { tipo: "doc_arquivo", id: a!.id }, { pastaId: b.pastaId, titulo: b.titulo, tamanho: bytes.length });
    reply.code(201);
    return { id: a!.id };
  });

  app.patch("/api/documentos/arquivos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const a = await arquivoVisivel(req, id);
    const c = z.object({
      titulo: z.string().trim().min(2).max(160).optional(),
      descricao: z.string().trim().max(500).nullish(),
      vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      pastaId: uuid.optional(),
    }).parse(req.body);
    if (c.pastaId && c.pastaId !== a.pastaId) await pastaVisivel(req, c.pastaId);
    await db.update(docArquivos).set({
      ...(c.titulo ? { titulo: c.titulo } : {}), ...(c.descricao !== undefined ? { descricao: c.descricao || null } : {}),
      ...(c.vencimento !== undefined ? { vencimento: c.vencimento || null } : {}), ...(c.pastaId ? { pastaId: c.pastaId } : {}), atualizadoEm: new Date(),
    }).where(eq(docArquivos.id, id));
    await auditar(db, req, "DOC_ALTERADO", { tipo: "doc_arquivo", id }, { campos: Object.keys(c), pastaAntes: c.pastaId ? a.pastaId : undefined });
    return { ok: true };
  });

  /** Apagar: o conteúdo sai do banco (não fica cópia), o registro da auditoria fica. */
  app.delete("/api/documentos/arquivos/:id", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const a = await arquivoVisivel(req, id);
    await db.delete(docArquivos).where(eq(docArquivos.id, id));
    await auditar(db, req, "DOC_EXCLUIDO", { tipo: "doc_arquivo", id }, { titulo: a.titulo, pastaId: a.pastaId });
    return { ok: true };
  });

  /** Abre (PDF e imagens no navegador) ou baixa (?baixar=1). Sempre registrado na auditoria. */
  app.get("/api/documentos/arquivos/:id/conteudo", ver, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { baixar } = z.object({ baixar: z.string().optional() }).parse(req.query);
    const a = await arquivoVisivel(req, id);
    await auditar(db, req, "DOC_ABERTO", { tipo: "doc_arquivo", id }, { titulo: a.titulo, baixou: !!baixar });
    const bytes = Buffer.from(cofre.decifrar(a.dadosCifrados), "base64");
    const exibir = !baixar && /^(application\/pdf|image\/(jpeg|png))$/.test(a.mime);
    return reply.header("Content-Type", a.mime).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `${exibir ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.nomeArquivo)}`).send(bytes);
  });

  /** Para o administrador montar a lista de acesso das pastas: perfis e pessoas (só nome). */
  app.get("/api/documentos/opcoes-acesso", ver, async (req) => {
    if (!ehAdmin(req.usuario!)) throw new ErroHttp(403, "SEM_PERMISSAO", "Só o administrador define o acesso das pastas.");
    const listaPerfis = await db.select({ codigo: perfis.codigo, nome: perfis.nome }).from(perfis).orderBy(asc(perfis.nome));
    const pessoas = await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(eq(usuarios.ativo, true)).orderBy(asc(usuarios.nome));
    return { perfis: listaPerfis, usuarios: pessoas };
  });
}
