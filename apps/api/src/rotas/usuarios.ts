import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { auditoria, PERFIS, sessoes, usuarios } from "../db/schema.js";
import { gerarHashSenha } from "../seguranca/senha.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";

const publico = { id: usuarios.id, nome: usuarios.nome, email: usuarios.email, perfil: usuarios.perfil, ativo: usuarios.ativo, totpAtivo: usuarios.totpAtivo, trocarSenha: usuarios.trocarSenha, criadoEm: usuarios.criadoEm };

/** Senha temporária forte, entregue uma única vez ao administrador. */
function senhaTemporaria(): string {
  return randomBytes(9).toString("base64url") + "7a";
}

export async function rotasUsuarios(app: FastifyInstance, { db, config }: Contexto) {
  const admin = { preHandler: exigir(config, "usuarios:gerenciar") };

  app.get("/api/usuarios", admin, async () => db.select(publico).from(usuarios).orderBy(usuarios.nome));

  app.post("/api/usuarios", admin, async (req) => {
    const corpo = z.object({ nome: z.string().trim().min(2).max(120), email: z.string().email().max(200), perfil: z.enum(PERFIS) }).parse(req.body);
    const temporaria = senhaTemporaria();
    try {
      const [u] = await db.insert(usuarios).values({ ...corpo, email: corpo.email.toLowerCase(), senhaHash: await gerarHashSenha(temporaria), trocarSenha: true }).returning(publico);
      await auditar(db, req, "USUARIO_CRIADO", { tipo: "usuario", id: u!.id }, { perfil: corpo.perfil });
      return { usuario: u, senhaTemporaria: temporaria };
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ErroHttp(409, "EMAIL_EM_USO", "Já existe um usuário com este e-mail.");
      throw e;
    }
  });

  app.patch("/api/usuarios/:id", admin, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const corpo = z.object({
      nome: z.string().trim().min(2).max(120).optional(),
      perfil: z.enum(PERFIS).optional(),
      ativo: z.boolean().optional(),
      redefinirSenha: z.boolean().optional(),
      redefinirMfa: z.boolean().optional(),
    }).parse(req.body);
    if (id === req.usuario!.id && (corpo.ativo === false || (corpo.perfil && corpo.perfil !== "ADMIN"))) {
      throw new ErroHttp(400, "AUTO_REBAIXAMENTO", "Você não pode desativar nem rebaixar o próprio usuário.");
    }
    const mudancas: Partial<typeof usuarios.$inferInsert> = {};
    if (corpo.nome) mudancas.nome = corpo.nome;
    if (corpo.perfil) mudancas.perfil = corpo.perfil;
    if (corpo.ativo !== undefined) mudancas.ativo = corpo.ativo;
    let temporaria: string | undefined;
    if (corpo.redefinirSenha) {
      temporaria = senhaTemporaria();
      mudancas.senhaHash = await gerarHashSenha(temporaria);
      mudancas.trocarSenha = true;
      mudancas.tentativasFalhas = 0;
      mudancas.bloqueadoAte = null;
    }
    if (corpo.redefinirMfa) Object.assign(mudancas, { totpAtivo: false, totpSegredoCifrado: null });
    const [u] = await db.update(usuarios).set(mudancas).where(eq(usuarios.id, id)).returning(publico);
    if (!u) throw new ErroHttp(404, "NAO_ENCONTRADO", "Usuário não encontrado.");
    if (corpo.ativo === false || corpo.redefinirSenha || corpo.redefinirMfa || corpo.perfil) {
      await db.update(sessoes).set({ revogada: true }).where(eq(sessoes.usuarioId, id));
    }
    await auditar(db, req, "USUARIO_ALTERADO", { tipo: "usuario", id }, { ...corpo });
    return { usuario: u, senhaTemporaria: temporaria };
  });

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
