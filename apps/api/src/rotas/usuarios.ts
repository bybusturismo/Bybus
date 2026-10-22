import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { auditoria, perfis, sessoes, unidades, usuarios, usuariosUnidades } from "../db/schema.js";
import { CATALOGO_PERMISSOES, ehPermissao, exigeMfa, PERMISSOES } from "../seguranca/permissoes.js";
import { gerarHashSenha } from "../seguranca/senha.js";
import { ErroHttp, exigir, type UsuarioSessao } from "../seguranca/sessao.js";
import { podeUnidade } from "../seguranca/escopo.js";
import { perfilPorCodigo, validarUnidades } from "../servicos/perfis.js";

/** Senha temporária forte, entregue uma única vez ao administrador. */
function senhaTemporaria(): string {
  return randomBytes(9).toString("base64url") + "7a";
}

const uuid = z.string().uuid();
const codigoPerfil = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_]+$/, "Use letras, números e _");

const ehAdmin = (u: UsuarioSessao) => u.perfil === "ADMIN";
const contido = (a: readonly string[], b: readonly string[]) => a.every((x) => b.includes(x));

export async function rotasUsuarios(app: FastifyInstance, { db, config }: Contexto) {
  const admin = { preHandler: exigir(config, "usuarios:gerenciar") };

  /**
   * Regra anti-escalonamento: quem não é ADMIN só gerencia usuários "menores ou iguais" a ele
   * (perfil com permissões contidas nas suas e praças dentro das suas) e só concede o que já tem.
   */
  type Alvo = { id: string; perfil: string; permissoes: string[]; todasUnidades: boolean; unidadeIds: string[]; ativo: boolean };
  function alvoDentroDoAlcance(ator: UsuarioSessao, alvo: Alvo): boolean {
    if (ehAdmin(ator)) return true;
    if (alvo.perfil === "ADMIN") return false;
    if (!contido(alvo.permissoes, ator.permissoes)) return false;
    if (alvo.todasUnidades && !ator.todasUnidades) return false;
    return alvo.unidadeIds.every((id) => podeUnidade(ator, id));
  }
  function podeConceder(ator: UsuarioSessao, perfil: { codigo: string; permissoes: string[] } | null, todasUnidades?: boolean, unidadeIds?: string[]) {
    if (ehAdmin(ator)) return;
    if (perfil && (perfil.codigo === "ADMIN" || !contido(perfil.permissoes, ator.permissoes))) {
      throw new ErroHttp(403, "SEM_PERMISSAO", "Você não pode conceder um perfil com mais acesso que o seu.");
    }
    if (todasUnidades === true && !ator.todasUnidades) throw new ErroHttp(403, "SEM_PERMISSAO", "Você não pode conceder acesso a todas as praças.");
    if (unidadeIds?.some((id) => !podeUnidade(ator, id))) throw new ErroHttp(403, "SEM_PERMISSAO", "Você só pode conceder acesso às suas praças.");
  }
  async function carregarAlvos(ids?: string[]): Promise<Alvo[]> {
    const base = db.select({ id: usuarios.id, perfil: perfis.codigo, permissoes: perfis.permissoes, todasUnidades: usuarios.todasUnidades, ativo: usuarios.ativo })
      .from(usuarios).innerJoin(perfis, eq(perfis.id, usuarios.perfilId));
    const lista = ids ? await base.where(inArray(usuarios.id, ids)) : await base;
    const vinculos = await db.select().from(usuariosUnidades);
    return lista.map((u) => ({ ...u, unidadeIds: vinculos.filter((v) => v.usuarioId === u.id).map((v) => v.unidadeId) }));
  }
  async function haOutroAdminAtivo(excetoId: string) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(usuarios).innerJoin(perfis, eq(perfis.id, usuarios.perfilId))
      .where(and(eq(perfis.codigo, "ADMIN"), eq(usuarios.ativo, true), ne(usuarios.id, excetoId)));
    return (r?.n ?? 0) > 0;
  }

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
  app.get("/api/usuarios", admin, async (req) => {
    const ator = req.usuario!;
    const visiveis = new Set((await carregarAlvos()).filter((a) => a.id === ator.id || alvoDentroDoAlcance(ator, a)).map((a) => a.id));
    return (await listarUsuarios()).filter((u) => visiveis.has(u.id));
  });

  app.post("/api/usuarios", admin, async (req) => {
    const corpo = z.object({
      nome: z.string().trim().min(2).max(120),
      email: z.string().email().max(200),
      perfil: codigoPerfil,
      todasUnidades: z.boolean().default(false),
      unidadeIds: z.array(uuid).max(50).default([]),
    }).parse(req.body);
    const perfil = await perfilPorCodigo(db, corpo.perfil);
    podeConceder(req.usuario!, perfil, corpo.todasUnidades, corpo.unidadeIds);
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
    const ator = req.usuario!;
    const [alvo] = await carregarAlvos([id]);
    if (!alvo || (alvo.id !== ator.id && !alvoDentroDoAlcance(ator, alvo))) throw new ErroHttp(404, "NAO_ENCONTRADO", "Usuário não encontrado.");
    if (id === ator.id && (corpo.ativo !== undefined || corpo.perfil || corpo.todasUnidades !== undefined || corpo.unidadeIds || corpo.redefinirMfa)) {
      throw new ErroHttp(400, "AUTO_ALTERACAO", "Você não pode alterar o próprio perfil, praças, status ou MFA — peça a outro administrador.");
    }
    const novoPerfil = corpo.perfil ? await perfilPorCodigo(db, corpo.perfil) : null;
    podeConceder(ator, novoPerfil, corpo.todasUnidades, corpo.unidadeIds);
    // Nunca deixar a empresa sem administrador ativo.
    if (alvo.perfil === "ADMIN" && alvo.ativo && (corpo.ativo === false || (novoPerfil && novoPerfil.codigo !== "ADMIN")) && !(await haOutroAdminAtivo(id))) {
      throw new ErroHttp(400, "ULTIMO_ADMIN", "Este é o último administrador ativo.");
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
    const [depois] = await carregarAlvos([id]);
    await auditar(db, req, "USUARIO_ALTERADO", { tipo: "usuario", id }, {
      campos: Object.keys(corpo),
      antes: { perfil: alvo.perfil, todasUnidades: alvo.todasUnidades, unidades: alvo.unidadeIds, ativo: alvo.ativo },
      depois: depois && { perfil: depois.perfil, todasUnidades: depois.todasUnidades, unidades: depois.unidadeIds, ativo: depois.ativo },
    });
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
    if (corpo.codigo.toUpperCase() === "ADMIN") throw new ErroHttp(400, "PERFIL_PROTEGIDO", "Código reservado.");
    podeConceder(req.usuario!, { codigo: corpo.codigo, permissoes: corpo.permissoes });
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
    const ator = req.usuario!;
    if (!ehAdmin(ator)) {
      if (atual.sistema) throw new ErroHttp(403, "SEM_PERMISSAO", "Perfis padrão do sistema só podem ser alterados pelo Administrador.");
      if (!contido(atual.permissoes, ator.permissoes)) throw new ErroHttp(404, "NAO_ENCONTRADO", "Perfil não encontrado.");
      if (corpo.permissoes) podeConceder(ator, { codigo: atual.codigo, permissoes: corpo.permissoes });
    }
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
    if (!req.usuario!.todasUnidades) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem acessa todas as praças pode criar praças.");
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
    if (!req.usuario!.todasUnidades) throw new ErroHttp(403, "SEM_PERMISSAO", "Só quem acessa todas as praças pode editá-las.");
    const corpo = esquemaUnidade.omit({ codigo: true }).partial().parse(req.body);
    const [x] = await db.update(unidades).set({ ...corpo, ...(corpo.uf ? { uf: corpo.uf.toUpperCase() } : {}) }).where(eq(unidades.id, id)).returning();
    if (!x) throw new ErroHttp(404, "NAO_ENCONTRADO", "Praça não encontrada.");
    await auditar(db, req, "UNIDADE_ALTERADA", { tipo: "unidade", id }, corpo);
    return x;
  });

  // ---------- Auditoria ----------
  app.get("/api/auditoria", { preHandler: exigir(config, "auditoria:ver") }, async (req) => {
    const { limite } = z.object({ limite: z.coerce.number().min(1).max(500).default(200) }).parse(req.query);
    const ator = req.usuario!;
    // Sem acesso a todas as praças: só eventos de usuários das suas praças (e dele mesmo).
    const filtro = ator.todasUnidades ? undefined : or(
      eq(auditoria.usuarioId, ator.id),
      inArray(auditoria.usuarioId, db.select({ id: usuariosUnidades.usuarioId }).from(usuariosUnidades)
        .innerJoin(usuarios, eq(usuarios.id, usuariosUnidades.usuarioId))
        .where(and(eq(usuarios.todasUnidades, false), ator.unidadeIds.length ? inArray(usuariosUnidades.unidadeId, ator.unidadeIds) : sql`false`))),
    );
    return db
      .select({ id: auditoria.id, acao: auditoria.acao, entidade: auditoria.entidade, entidadeId: auditoria.entidadeId, dados: auditoria.dados, ip: auditoria.ip, criadoEm: auditoria.criadoEm, usuario: usuarios.nome })
      .from(auditoria)
      .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
      .where(filtro)
      .orderBy(desc(auditoria.criadoEm))
      .limit(limite);
  });
}
