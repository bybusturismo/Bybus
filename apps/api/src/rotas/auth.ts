import { and, eq, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { authenticator } from "otplib";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { sessoes, usuarios } from "../db/schema.js";
import { conferirSenha, gerarHashSenha, obterHashFalso, validarPoliticaSenha } from "../seguranca/senha.js";
import { COOKIE_SESSAO, criarSessao, ErroHttp, pendencia } from "../seguranca/sessao.js";
import { MATRIZ } from "../seguranca/permissoes.js";

authenticator.options = { window: 1 };

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MINUTOS = 15;

export async function rotasAuth(app: FastifyInstance, { db, config, cofre }: Contexto) {
  app.post("/api/auth/login", { config: { rateLimit: { max: config.LIMITE_LOGIN_POR_MINUTO, timeWindow: "1 minute" } } }, async (req, reply) => {
    const corpo = z.object({ email: z.string().email().max(200), senha: z.string().min(1).max(200), codigo: z.string().max(10).optional() }).parse(req.body);
    const [u] = await db.select().from(usuarios).where(sql`lower(${usuarios.email}) = lower(${corpo.email})`).limit(1);

    const falhar = async () => {
      throw new ErroHttp(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha incorretos.");
    };

    if (!u || !u.ativo) {
      await conferirSenha(await obterHashFalso(), corpo.senha);
      await auditar(db, req, "LOGIN_FALHOU", { tipo: "usuario" }, { email: corpo.email.toLowerCase() });
      return falhar();
    }
    if (u.bloqueadoAte && u.bloqueadoAte > new Date()) {
      throw new ErroHttp(423, "USUARIO_BLOQUEADO", "Muitas tentativas. Tente novamente em alguns minutos.");
    }
    if (!(await conferirSenha(u.senhaHash, corpo.senha))) {
      const tentativas = u.tentativasFalhas + 1;
      await db.update(usuarios).set({
        tentativasFalhas: tentativas >= MAX_TENTATIVAS ? 0 : tentativas,
        bloqueadoAte: tentativas >= MAX_TENTATIVAS ? new Date(Date.now() + BLOQUEIO_MINUTOS * 60_000) : null,
      }).where(eq(usuarios.id, u.id));
      await auditar(db, req, tentativas >= MAX_TENTATIVAS ? "USUARIO_BLOQUEADO" : "LOGIN_FALHOU", { tipo: "usuario", id: u.id }, undefined, u.id);
      return falhar();
    }
    if (u.totpAtivo) {
      if (!corpo.codigo) return reply.status(401).send({ codigo: "MFA_NECESSARIO", mensagem: "Informe o código do aplicativo autenticador." });
      const segredo = cofre.decifrar(u.totpSegredoCifrado!);
      if (!authenticator.check(corpo.codigo.replace(/\s/g, ""), segredo)) {
        await auditar(db, req, "MFA_FALHOU", { tipo: "usuario", id: u.id }, undefined, u.id);
        throw new ErroHttp(401, "MFA_INVALIDO", "Código de verificação inválido.");
      }
    }

    await db.update(usuarios).set({ tentativasFalhas: 0, bloqueadoAte: null }).where(eq(usuarios.id, u.id));
    await criarSessao(db, config, req, reply, u.id);
    await auditar(db, req, "LOGIN", { tipo: "usuario", id: u.id }, undefined, u.id);
    return { usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil } };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.usuario) {
      await db.update(sessoes).set({ revogada: true }).where(eq(sessoes.id, req.usuario.sessaoId));
      await auditar(db, req, "LOGOUT");
    }
    reply.clearCookie(COOKIE_SESSAO, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/eu", async (req) => {
    const u = req.usuario;
    if (!u) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
    return {
      usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, totpAtivo: u.totpAtivo },
      pendencia: pendencia(u, config),
      permissoes: MATRIZ[u.perfil],
    };
  });

  app.post("/api/auth/senha", { config: { rateLimit: { max: config.LIMITE_LOGIN_POR_MINUTO, timeWindow: "1 minute" } } }, async (req) => {
    const u = req.usuario;
    if (!u) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
    const corpo = z.object({ senhaAtual: z.string().max(200), novaSenha: z.string().max(200) }).parse(req.body);
    const [linha] = await db.select().from(usuarios).where(eq(usuarios.id, u.id));
    if (!linha || !(await conferirSenha(linha.senhaHash, corpo.senhaAtual))) throw new ErroHttp(400, "SENHA_ATUAL_INCORRETA", "Senha atual incorreta.");
    const erro = validarPoliticaSenha(corpo.novaSenha);
    if (erro) throw new ErroHttp(400, "SENHA_FRACA", erro);
    if (corpo.novaSenha === corpo.senhaAtual) throw new ErroHttp(400, "SENHA_REPETIDA", "A nova senha deve ser diferente da atual.");
    await db.update(usuarios).set({ senhaHash: await gerarHashSenha(corpo.novaSenha), trocarSenha: false }).where(eq(usuarios.id, u.id));
    // Encerra as outras sessões do usuário.
    await db.update(sessoes).set({ revogada: true }).where(and(eq(sessoes.usuarioId, u.id), ne(sessoes.id, u.sessaoId)));
    await auditar(db, req, "SENHA_ALTERADA", { tipo: "usuario", id: u.id });
    return { ok: true };
  });

  app.post("/api/auth/mfa/iniciar", async (req) => {
    const u = req.usuario;
    if (!u) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
    if (u.trocarSenha) throw new ErroHttp(403, "TROCAR_SENHA", "Troque sua senha antes de continuar.");
    if (u.totpAtivo) throw new ErroHttp(409, "MFA_JA_ATIVO", "A verificação em duas etapas já está ativa.");
    const segredo = authenticator.generateSecret();
    await db.update(usuarios).set({ totpSegredoCifrado: cofre.cifrar(segredo) }).where(eq(usuarios.id, u.id));
    return { segredo, otpauth: authenticator.keyuri(u.email, "Bybus Gestão", segredo) };
  });

  app.post("/api/auth/mfa/ativar", { config: { rateLimit: { max: config.LIMITE_LOGIN_POR_MINUTO, timeWindow: "1 minute" } } }, async (req) => {
    const u = req.usuario;
    if (!u) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
    const { codigo } = z.object({ codigo: z.string().max(10) }).parse(req.body);
    const [linha] = await db.select().from(usuarios).where(eq(usuarios.id, u.id));
    if (!linha?.totpSegredoCifrado) throw new ErroHttp(400, "MFA_NAO_INICIADO", "Inicie a configuração primeiro.");
    if (!authenticator.check(codigo.replace(/\s/g, ""), cofre.decifrar(linha.totpSegredoCifrado))) {
      throw new ErroHttp(400, "MFA_INVALIDO", "Código inválido. Confira o horário do celular e tente de novo.");
    }
    await db.update(usuarios).set({ totpAtivo: true }).where(eq(usuarios.id, u.id));
    await auditar(db, req, "MFA_ATIVADO", { tipo: "usuario", id: u.id });
    return { ok: true };
  });
}
