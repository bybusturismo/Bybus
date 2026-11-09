import { FICHA_SENSIVEL_VAZIA, VINCULOS, ANEXO_MAX_BYTES, TIPOS_ANEXO, normalizarFichaSensivel, tipoDoArquivo, type FichaSensivel } from "@bybus/core";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { usuarios, usuariosAnexos, usuariosFichas, usuariosFotos } from "../db/schema.js";
import { lerFoto } from "./auth.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";

const uuid = z.string().uuid();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD").nullable();
const txt = (n: number) => z.string().trim().max(n).nullable().transform((v) => v || null);

/**
 * Ficha completa do usuário (09/11/2026). LGPD: só `usuarios:ficha`; a parte sensível é cifrada; a auditoria guarda só
 * QUE a ficha foi vista/alterada (nunca os dados); anexos só PDF/JPG/PNG conferidos pelos bytes, cifrados, até 5 MB.
 */
export async function rotasFichas(app: FastifyInstance, { db, config, cofre }: Contexto) {
  const pre = { preHandler: exigir(config, "usuarios:ficha") };

  async function garantirUsuario(id: string) {
    const [u] = await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(eq(usuarios.id, id));
    if (!u) throw new ErroHttp(404, "NAO_ENCONTRADO", "Usuário não encontrado.");
    return u;
  }
  const abrir = (cifrado: string | null): FichaSensivel => {
    if (!cifrado) return structuredClone(FICHA_SENSIVEL_VAZIA);
    return { ...structuredClone(FICHA_SENSIVEL_VAZIA), ...(JSON.parse(cofre.decifrar(cifrado)) as Partial<FichaSensivel>) };
  };

  // ---------- Foto do usuário (pedido do dono, 09/11/2026): quem gerencia usuários vê e troca a foto de qualquer um ----------
  const gerenciar = { preHandler: exigir(config, "usuarios:gerenciar") };
  app.get("/api/usuarios/:id/foto", gerenciar, async (req, reply) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const [f] = await db.select().from(usuariosFotos).where(eq(usuariosFotos.usuarioId, id));
    if (!f) throw new ErroHttp(404, "SEM_FOTO", "Sem foto.");
    return reply.header("content-type", f.tipo).header("cache-control", "private, max-age=86400").send(Buffer.from(f.dados, "base64"));
  });
  app.put("/api/usuarios/:id/foto", { ...gerenciar, bodyLimit: 400_000 }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await garantirUsuario(id);
    const valores = { ...lerFoto(req.body), atualizadaEm: new Date() };
    await db.insert(usuariosFotos).values({ usuarioId: id, ...valores }).onConflictDoUpdate({ target: usuariosFotos.usuarioId, set: valores });
    await auditar(db, req, "FOTO_PERFIL_ALTERADA", { tipo: "usuario", id });
    return { fotoVersao: valores.atualizadaEm.getTime() };
  });
  app.delete("/api/usuarios/:id/foto", gerenciar, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await db.delete(usuariosFotos).where(eq(usuariosFotos.usuarioId, id));
    await auditar(db, req, "FOTO_PERFIL_REMOVIDA", { tipo: "usuario", id });
    return { ok: true };
  });

  app.get("/api/usuarios/:id/ficha", pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const u = await garantirUsuario(id);
    const [f] = await db.select().from(usuariosFichas).where(eq(usuariosFichas.usuarioId, id));
    const anexos = await db.select({ id: usuariosAnexos.id, tipo: usuariosAnexos.tipo, nome: usuariosAnexos.nome, mime: usuariosAnexos.mime, tamanho: usuariosAnexos.tamanho, criadoEm: usuariosAnexos.criadoEm })
      .from(usuariosAnexos).where(eq(usuariosAnexos.usuarioId, id)).orderBy(desc(usuariosAnexos.criadoEm));
    await auditar(db, req, "FICHA_VISTA", { tipo: "usuario", id }, {});
    return {
      usuario: u, vinculos: VINCULOS.map(([valor, rotulo]) => ({ valor, rotulo })), tiposAnexo: TIPOS_ANEXO.map(([valor, rotulo]) => ({ valor, rotulo })),
      ficha: {
        apelido: f?.apelido ?? null, nascimento: f?.nascimento ?? null, telefone: f?.telefone ?? null, vinculo: f?.vinculo ?? null, cargo: f?.cargo ?? null,
        admissao: f?.admissao ?? null, desligamento: f?.desligamento ?? null, ...abrir(f?.dadosCifrados ?? null),
        pixAlteradoEm: f?.pixAlteradoEm ?? null, atualizadoEm: f?.atualizadoEm ?? null,
      },
      anexos,
    };
  });

  app.put("/api/usuarios/:id/ficha", pre, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await garantirUsuario(id);
    const b = z.object({
      apelido: txt(60), nascimento: data, telefone: txt(30), vinculo: z.enum(VINCULOS.map(([v]) => v) as [string, ...string[]]).nullable(), cargo: txt(80),
      admissao: data, desligamento: data,
      cpf: txt(20), rg: txt(30), rgOrgao: txt(30), cnpj: txt(20), emailPessoal: z.string().trim().email("E-mail pessoal inválido.").max(200).nullable().or(z.literal("").transform(() => null)),
      endereco: z.record(z.string(), z.string().nullable()).default({}), emergencia: z.record(z.string(), z.string().nullable()).default({}),
      pix: z.record(z.string(), z.string().nullable()).default({}), banco: z.record(z.string(), z.string().nullable()).default({}), anotacoes: txt(4000),
    }).parse(req.body);
    if (b.admissao && b.desligamento && b.desligamento < b.admissao) throw new ErroHttp(400, "DATAS_INVALIDAS", "O desligamento não pode ser antes da admissão.");
    let sens: FichaSensivel;
    try { sens = normalizarFichaSensivel(b); } catch (e) { throw new ErroHttp(400, "FICHA_INVALIDA", (e as Error).message); }
    const [antes] = await db.select().from(usuariosFichas).where(eq(usuariosFichas.usuarioId, id));
    const pixAntes = abrir(antes?.dadosCifrados ?? null).pix;
    const trocouPix = (pixAntes.chave ?? null) !== (sens.pix.chave ?? null) || (pixAntes.tipo ?? null) !== (sens.pix.tipo ?? null);
    const valores = {
      apelido: b.apelido, nascimento: b.nascimento, telefone: b.telefone, vinculo: b.vinculo, cargo: b.cargo, admissao: b.admissao, desligamento: b.desligamento,
      dadosCifrados: cofre.cifrar(JSON.stringify(sens)), atualizadoEm: new Date(), atualizadoPor: req.usuario!.id,
      ...(trocouPix && antes ? { pixAlteradoEm: new Date(), pixAlteradoPor: req.usuario!.id } : {}),
    };
    await db.insert(usuariosFichas).values({ usuarioId: id, ...valores }).onConflictDoUpdate({ target: usuariosFichas.usuarioId, set: valores });
    await auditar(db, req, "FICHA_ALTERADA", { tipo: "usuario", id }, { trocouPix: trocouPix && !!antes });
    return { ok: true };
  });

  app.post("/api/usuarios/:id/anexos", { ...pre, bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await garantirUsuario(id);
    const b = z.object({ tipo: z.enum(TIPOS_ANEXO.map(([v]) => v) as [string, ...string[]]), nome: z.string().trim().min(1).max(160), base64: z.string().min(8) }).parse(req.body);
    const bytes = Buffer.from(b.base64, "base64");
    if (bytes.length > ANEXO_MAX_BYTES) throw new ErroHttp(400, "ANEXO_GRANDE", "O arquivo pode ter até 5 MB.");
    const mime = tipoDoArquivo(bytes);
    if (!mime) throw new ErroHttp(400, "ANEXO_TIPO", "Envie PDF, JPG ou PNG.");
    const nome = b.nome.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
    const [a] = await db.insert(usuariosAnexos).values({ usuarioId: id, tipo: b.tipo, nome, mime, tamanho: bytes.length, dadosCifrados: cofre.cifrar(bytes.toString("base64")), criadoPor: req.usuario!.id })
      .returning({ id: usuariosAnexos.id });
    await auditar(db, req, "FICHA_ANEXO_ENVIADO", { tipo: "usuario", id }, { anexoId: a!.id, tipo: b.tipo });
    return { id: a!.id };
  });

  app.get("/api/usuarios/:id/anexos/:anexoId", pre, async (req, reply) => {
    const { id, anexoId } = z.object({ id: uuid, anexoId: uuid }).parse(req.params);
    const [a] = await db.select().from(usuariosAnexos).where(and(eq(usuariosAnexos.id, anexoId), eq(usuariosAnexos.usuarioId, id)));
    if (!a) throw new ErroHttp(404, "NAO_ENCONTRADO", "Anexo não encontrado.");
    await auditar(db, req, "FICHA_ANEXO_ABERTO", { tipo: "usuario", id }, { anexoId });
    const bytes = Buffer.from(cofre.decifrar(a.dadosCifrados), "base64");
    return reply.header("Content-Type", a.mime).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(a.nome)}`).send(bytes);
  });

  app.delete("/api/usuarios/:id/anexos/:anexoId", pre, async (req) => {
    const { id, anexoId } = z.object({ id: uuid, anexoId: uuid }).parse(req.params);
    const r = await db.delete(usuariosAnexos).where(and(eq(usuariosAnexos.id, anexoId), eq(usuariosAnexos.usuarioId, id))).returning({ id: usuariosAnexos.id });
    if (!r.length) throw new ErroHttp(404, "NAO_ENCONTRADO", "Anexo não encontrado.");
    await auditar(db, req, "FICHA_ANEXO_EXCLUIDO", { tipo: "usuario", id }, { anexoId });
    return { ok: true };
  });
}
