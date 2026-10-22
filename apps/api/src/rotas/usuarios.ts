import { asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { auditoria, perfis, sessoes, unidades, usuarios, usuariosUnidades } from "../db/schema.js";
import { CATALOGO_PERMISSOES, ehPermissao, exigeMfa, PERMISSOES } from "../seguranca/permissoes.js";
import { gerarHashSenha } from "../seguranca/senha.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { perfilPorCodigo, validarUnidades } from "../servicos/perfis.js";

/** Senha temporária forte, entregue uma única vez ao administrador. */
function senhaTemporaria(): string {
  return randomBytes(9).toString("base64url") + "7a";
}

const uuid = z.string().uuid();
const codigoPerfil = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_]+$/, "Use letras, números e _");

export async function rotasUsuarios(app: FastifyInstance, { db, config }: Contexto) {
  const admin = { preHandler: exigir(config, "usuarios:gerenciar") };

  async function listarUsuarios(id?: string) {
    const base = db
      .select({
        id: usuarios.id, nome: usuarios.nome, email: usuarios.email, perfil: perfis.codigo, perfilNome: perfis.nome,
        todasUnidades: usuarios.todasUnidades, ativo: usuarios.ativo, totpAtivo: usuarios.totpAtivo,
        trocarSenha: usuarios.trocarSenha, criadoEm: usuarios.criadoEm,
      })
      .from(usuarios)
      .innerJoin(perfis, eq(perfis.id, usuarios.perfilId));
    const lista = id ? await base.where(eq(usuarios.id, id)) : await base.orderBy(usuarios.nome);
    const vinculos = await db.select().from(usuariosUnidades);
    return lista.map((u) => ({ ...u, unidadeIds: vinculos.filter((v) => v.usuarioId === u.id).map((v) => v.unidadeId) }));
  }

  async function definirUnidades(usuarioId: string, ids: string[]) {
    await validarUnidades(db, ids);
    await db.delete(usuariosUnidades).where(eq(usuariosUnidades.usuarioId, usuarioId));
    if (ids.length) await db.insert(usuariosUnidades).values([...new Set(ids)].map((unidadeId) => ({ usuarioId, unidadeId })));
  }

  // ---------- Usuários ----------
  app.get("/api/usuarios", admin, async () => listarUsuarios());

  app.post("/api/usuarios", admin, async (req) => {
    const corpo = z.object({
      nome: z.string().trim().min(2).max(120),
      email: z.string().email().max(200),
      perfil: codigoPerfil,
      todasUnidades: z.boolean().default(false),
      unidadeIds: z.array(uuid).max(50).default([]),
    }).parse(req.body);
    const perfil = await perfilPorCodigo(db, corpo.perfil);
    const temporaria = senhaTemporaria();
    try {
      const [u] = await db.insert(usuarios).values({
        nome: corpo.nome, email: corpo.email.toLowerCase(), perfilId: perfil.id, todasUnidades: corpo.todasUnidades,
        senhaHash: await gerarHashSenha(temporaria), trocarSenha: true,
      }).returning({ id: usuarios.id });
      await definirUnidades(u!.id, corpo.unidadeIds);
      await auditar(db, req, "USUARIO_CRIADO", { tipo: "usuario", id: u!.id }, { perfil: perfil.codigo, todasUnidades: corpo.todasUnidades, unidades: corpo.unidadeIds.length });
      return { usuario: (await listarUsuarios(u!.id))[0], senhaTemporaria: temporaria };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "EMAIL_EM_USO", "Já existe um usuário com este e-mail.");
      throw e;
    }
  });

  app.patch("/api/usuarios/:id", admin, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = z.object({
      nome: z.string().trim().min(2).max(120).optional(),
      perfil: codigoPerfil.optional(),
      todasUnidades: z.boolean().optional(),
      unidadeIds: z.array(uuid).max(50).optional(),
      ativo: z.boolean().optional(),
      redefinirSenha: z.boolean().optional(),
      redefinirMfa: z.boolean().optional(),
    }).parse(req.body);
    const novoPerfil = corpo.perfil ? await perfilPorCodigo(db, corpo.perfil) : null;
    if (id === req.usuario!.id && (corpo.ativo === false || (novoPerfil && !novoPerfil.permissoes.includes("usuarios:gerenciar")) || corpo.todasUnidades === false)) {
      throw new ErroHttp(400, "AUTO_REBAIXAMENTO", "Você não pode desativar nem reduzir o próprio acesso.");
    }
    const mudancas: Partial<typeof usuarios.$inferInsert> = {};
    if (corpo.nome) mudancas.nome = corpo.nome;
    if (novoPerfil) mudancas.perfilId = novoPerfil.id;
    if (corpo.todasUnidades !== undefined) mudancas.todasUnidades = corpo.todasUnidades;
    if (corpo.ativo !== undefined) mudancas.ativo = corpo.ativo;
    let temporaria: string | undefined;
    if (corpo.redefinirSenha) {
      temporaria = senhaTemporaria();
      Object.assign(mudancas, { senhaHash: await gerarHashSenha(temporaria), trocarSenha: true, tentativasFalhas: 0, bloqueios: 0, bloqueadoAte: null });
    }
    if (corpo.redefinirMfa) Object.assign(mudancas, { totpAtivo: false, totpSegredoCifrado: null, totpUltimoPasso: null });
    const [u] = Object.keys(mudancas).length
      ? await db.update(usuarios).set(mudancas).where(eq(usuarios.id, id)).returning({ id: usuarios.id })
      : await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.id, id));
    if (!u) throw new ErroHttp(404, "NAO_ENCONTRADO", "Usuário não encontrado.");
    if (corpo.unidadeIds) await definirUnidades(id, corpo.unidadeIds);
    if (corpo.ativo === false || corpo.redefinirSenha || corpo.redefinirMfa || corpo.perfil || corpo.unidadeIds || corpo.todasUnidades !== undefined) {
      await db.update(sessoes).set({ revogada: true }).where(eq(sessoes.usuarioId, id));
    }
    await auditar(db, req, "USUARIO_ALTERADO", { tipo: "usuario", id }, { campos: Object.keys(corpo) });
    return { usuario: (await listarUsuarios(id))[0], senhaTemporaria: temporaria };
  });

  // ---------- Perfis de acesso (configuráveis) ----------
  app.get("/api/permissoes", admin, async () =>
    PERMISSOES.map((codigo) => ({ codigo, descricao: CATALOGO_PERMISSOES[codigo], exigeMfa: exigeMfa([codigo]) })));

  app.get("/api/perfis", admin, async () => db.select().from(perfis).orderBy(desc(perfis.sistema), asc(perfis.nome)));

  const esquemaPerfil = z.object({
    nome: z.string().trim().min(2).max(80),
    descricao: z.string().trim().max(300).nullish(),
    permissoes: z.array(z.string().refine(ehPermissao, "Permissão desconhecida")).max(PERMISSOES.length),
  });

  app.post("/api/perfis", admin, async (req) => {
    const corpo = esquemaPerfil.extend({ codigo: codigoPerfil }).parse(req.body);
    try {
      const [p] = await db.insert(perfis).values({ ...corpo, codigo: corpo.codigo.toUpperCase(), permissoes: [...new Set(corpo.permissoes)] }).returning();
      await auditar(db, req, "PERFIL_CRIADO", { tipo: "perfil", id: p!.id }, { codigo: p!.codigo, permissoes: p!.permissoes });
      return p;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "PERFIL_EXISTE", "Já existe perfil com este código.");
      throw e;
    }
  });

  app.patch("/api/perfis/:id", admin, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = esquemaPerfil.partial().parse(req.body);
    const [atual] = await db.select().from(perfis).where(eq(perfis.id, id));
    if (!atual) throw new ErroHttp(404, "NAO_ENCONTRADO", "Perfil não encontrado.");
    // O perfil ADMIN é fixo: evita que alguém tranque a empresa fora do sistema.
    if (atual.codigo === "ADMIN" && corpo.permissoes) throw new ErroHttp(400, "PERFIL_PROTEGIDO", "As permissões do perfil Administrador não podem ser alteradas.");
    const [p] = await db.update(perfis).set({ ...corpo, ...(corpo.permissoes ? { permissoes: [...new Set(corpo.permissoes)] } : {}) }).where(eq(perfis.id, id)).returning();
    // Mudou permissões: encerra as sessões de quem usa o perfil para valer na hora.
    if (corpo.permissoes) {
      const afetados = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.perfilId, id));
      for (const a of afetados) await db.update(sessoes).set({ revogada: true }).where(eq(sessoes.usuarioId, a.id));
    }
    await auditar(db, req, "PERFIL_ALTERADO", { tipo: "perfil", id }, { antes: atual.permissoes, depois: p!.permissoes });
    return p;
  });

  // ---------- Praças / unidades ----------
  app.get("/api/unidades", { preHandler: exigir(config) }, async (req) => {
    const u = req.usuario!;
    const todas = await db.select().from(unidades).orderBy(unidades.nome);
    return u.todasUnidades ? todas : todas.filter((x) => u.unidadeIds.includes(x.id));
  });

  const esquemaUnidade = z.object({
    codigo: z.string().trim().min(2).max(10).regex(/^[A-Za-z0-9]+$/),
    nome: z.string().trim().min(2).max(120),
    cidade: z.string().trim().min(2).max(120),
    uf: z.string().trim().length(2),
    ativa: z.boolean().default(true),
  });

  app.post("/api/unidades", { preHandler: exigir(config, "unidades:gerenciar") }, async (req) => {
    const corpo = esquemaUnidade.parse(req.body);
    try {
      const [x] = await db.insert(unidades).values({ ...corpo, codigo: corpo.codigo.toUpperCase(), uf: corpo.uf.toUpperCase() }).returning();
      await auditar(db, req, "UNIDADE_CRIADA", { tipo: "unidade", id: x!.id }, { codigo: x!.codigo });
      return x;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "UNIDADE_EXISTE", "Já existe praça com este código.");
      throw e;
    }
  });

  app.patch("/api/unidades/:id", { preHandler: exigir(config, "unidades:gerenciar") }, async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const corpo = esquemaUnidade.omit({ codigo: true }).partial().parse(req.body);
    const [x] = await db.update(unidades).set({ ...corpo, ...(corpo.uf ? { uf: corpo.uf.toUpperCase() } : {}) }).where(eq(unidades.id, id)).returning();
    if (!x) throw new ErroHttp(404, "NAO_ENCONTRADO", "Praça não encontrada.");
    await auditar(db, req, "UNIDADE_ALTERADA", { tipo: "unidade", id }, corpo);
    return x;
  });

  // ---------- Auditoria ----------
  app.get("/api/auditoria", { preHandler: exigir(config, "auditoria:ver") }, async (req) => {
    const { limite } = z.object({ limite: z.coerce.number().min(1).max(500).default(200) }).parse(req.query);
    return db
      .select({ id: auditoria.id, acao: auditoria.acao, entidade: auditoria.entidade, entidadeId: auditoria.entidadeId, dados: auditoria.dados, ip: auditoria.ip, criadoEm: auditoria.criadoEm, usuario: usuarios.nome })
      .from(auditoria)
      .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
      .orderBy(desc(auditoria.criadoEm))
      .limit(limite);
  });
}
