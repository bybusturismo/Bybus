import { and, eq, gt, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { authenticator } from "otplib";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { perfis, sessoes, unidades, usuarios } from "../db/schema.js";
import { conferirSenha, gerarHashSenha, obterHashFalso, validarPoliticaSenha } from "../seguranca/senha.js";
import { criarSessao, ErroHttp, nomeCookie, pendencia } from "../seguranca/sessao.js";
import { sha256 } from "../seguranca/cripto.js";

authenticator.options = { window: 1 };

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MINUTOS = 15;

export async function rotasAuth(app: FastifyInstance, { db, config, cofre }: Contexto) {
  /** Registra falha (senha ou MFA) de forma atômica e aplica bloqueio progressivo: 15 min, 1 h, 4 h, 24 h. */
  async function registrarFalha(usuarioId: string) {
    const [r] = await db.update(usuarios)
      .set({ tentativasFalhas: sql`${usuarios.tentativasFalhas} + 1` })
      .where(eq(usuarios.id, usuarioId))
      .returning({ tentativas: usuarios.tentativasFalhas, bloqueios: usuarios.bloqueios });
    if (r && r.tentativas >= MAX_TENTATIVAS) {
      const minutos = Math.min(BLOQUEIO_MINUTOS * 4 ** r.bloqueios, 24 * 60);
      await db.update(usuarios).set({
        tentativasFalhas: 0,
        bloqueios: sql`${usuarios.bloqueios} + 1`,
        bloqueadoAte: new Date(Date.now() + minutos * 60_000),
      }).where(eq(usuarios.id, usuarioId));
      return true;
    }
    return false;
  }

  /** Confere o código TOTP e impede reutilizar um código já aceito. Retorna o passo aceito ou null. */
  function conferirTotp(codigo: string, segredo: string, ultimoPasso: number | null): number | null {
    const delta = authenticator.checkDelta(codigo.replace(/\s/g, ""), segredo);
    if (delta === null) return null;
    const passo = Math.floor(Date.now() / 1000 / 30) + delta;
    if (ultimoPasso !== null && passo <= ultimoPasso) return null;
    return passo;
  }

  app.post("/api/auth/login", { config: { rateLimit: { max: config.LIMITE_LOGIN_POR_MINUTO, timeWindow: "1 minute" } } }, async (req, reply) => {
    const corpo = z.object({ email: z.string().email().max(200), senha: z.string().min(1).max(200), codigo: z.string().max(10).optional() }).parse(req.body);
    const [u] = await db.select().from(usuarios).where(sql`lower(${usuarios.email}) = lower(${corpo.email})`).limit(1);

    // Mesma resposta para e-mail inexistente, senha errada e conta bloqueada (não revela quem existe).
    const recusar = () => {
      throw new ErroHttp(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha incorretos, ou acesso temporariamente bloqueado por excesso de tentativas.");
    };

    if (!u || !u.ativo) {
      await conferirSenha(await obterHashFalso(), corpo.senha);
      await auditar(db, req, "LOGIN_FALHOU", { tipo: "usuario" }, { emailHash: sha256(corpo.email.toLowerCase()) });
      return recusar();
    }
    const senhaOk = await conferirSenha(u.senhaHash, corpo.senha);
    if (u.bloqueadoAte && u.bloqueadoAte > new Date()) {
      await auditar(db, req, "LOGIN_RECUSADO_BLOQUEIO", { tipo: "usuario", id: u.id }, undefined, u.id);
      return recusar();
    }
    if (!senhaOk) {
      const bloqueou = await registrarFalha(u.id);
      await auditar(db, req, bloqueou ? "USUARIO_BLOQUEADO" : "LOGIN_FALHOU", { tipo: "usuario", id: u.id }, undefined, u.id);
      return recusar();
    }
    let passoAceito: number | null = null;
    if (u.totpAtivo) {
      if (!corpo.codigo) return reply.status(401).send({ codigo: "MFA_NECESSARIO", mensagem: "Informe o código do aplicativo autenticador." });
      passoAceito = conferirTotp(corpo.codigo, cofre.decifrar(u.totpSegredoCifrado!), u.totpUltimoPasso);
      if (passoAceito === null) {
        const bloqueou = await registrarFalha(u.id);
        await auditar(db, req, bloqueou ? "USUARIO_BLOQUEADO" : "MFA_FALHOU", { tipo: "usuario", id: u.id }, undefined, u.id);
        throw new ErroHttp(401, "MFA_INVALIDO", "Código de verificação inválido.");
      }
    }

    await db.update(usuarios).set({
      tentativasFalhas: 0, bloqueios: 0, bloqueadoAte: null,
      ...(passoAceito !== null ? { totpUltimoPasso: passoAceito } : {}),
    }).where(eq(usuarios.id, u.id));
    await criarSessao(db, config, req, reply, u.id);
    await auditar(db, req, "LOGIN", { tipo: "usuario", id: u.id }, undefined, u.id);
    const [perfil] = await db.select({ codigo: perfis.codigo }).from(perfis).where(eq(perfis.id, u.perfilId));
    return { usuario: { id: u.id, nome: u.nome, email: u.email, perfil: perfil?.codigo } };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.usuario) {
      await db.update(sessoes).set({ revogada: true }).where(eq(sessoes.id, req.usuario.sessaoId));
      await auditar(db, req, "LOGOUT");
    }
    reply.clearCookie(nomeCookie(config), { path: "/", secure: config.AMBIENTE !== "desenvolvimento" });
    return { ok: true };
  });

  app.get("/api/auth/eu", async (req) => {
    const u = req.usuario;
    if (!u) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
    return {
      usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, perfilNome: u.perfilNome, totpAtivo: u.totpAtivo, todasUnidades: u.todasUnidades },
      pendencia: pendencia(u, config),
      permissoes: u.permissoes,
      unidades: (await db.select({ id: unidades.id, codigo: unidades.codigo, nome: unidades.nome }).from(unidades).where(eq(unidades.ativa, true)).orderBy(unidades.nome))
        .filter((x) => u.todasUnidades || u.unidadeIds.includes(x.id)),
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
    const segredo = authenticator.generateSecret(20);
    await db.update(usuarios).set({ totpSegredoCifrado: cofre.cifrar(segredo) }).where(eq(usuarios.id, u.id));
    return { segredo, otpauth: authenticator.keyuri(u.email, "Bybus Gestão", segredo) };
  });

  app.post("/api/auth/mfa/ativar", { config: { rateLimit: { max: config.LIMITE_LOGIN_POR_MINUTO, timeWindow: "1 minute" } } }, async (req) => {
    const u = req.usuario;
    if (!u) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
    const { codigo } = z.object({ codigo: z.string().max(10) }).parse(req.body);
    const [linha] = await db.select().from(usuarios).where(eq(usuarios.id, u.id));
    if (!linha?.totpSegredoCifrado) throw new ErroHttp(400, "MFA_NAO_INICIADO", "Inicie a configuração primeiro.");
    const passo = conferirTotp(codigo, cofre.decifrar(linha.totpSegredoCifrado), linha.totpUltimoPasso);
    if (passo === null) {
      throw new ErroHttp(400, "MFA_INVALIDO", "Código inválido. Confira o horário do celular e tente de novo.");
    }
    await db.update(usuarios).set({ totpAtivo: true, totpUltimoPasso: passo }).where(eq(usuarios.id, u.id));
    await auditar(db, req, "MFA_ATIVADO", { tipo: "usuario", id: u.id });
    return { ok: true };
  });

  app.get("/api/auth/sessoes", async (req) => {
    const u = req.usuario;
    if (!u) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
    const lista = await db.select({ id: sessoes.id, criadaEm: sessoes.criadaEm, ultimoUso: sessoes.ultimoUso, ip: sessoes.ip, userAgent: sessoes.userAgent })
      .from(sessoes)
      .where(and(eq(sessoes.usuarioId, u.id), eq(sessoes.revogada, false), gt(sessoes.expiraEm, new Date())));
    // O id público é um prefixo do hash (nunca o token).
    return lista.map((s) => ({ ...s, id: s.id.slice(0, 16), atual: s.id === u.sessaoId }));
  });

  app.delete("/api/auth/sessoes/:id", async (req) => {
    const u = req.usuario;
    if (!u) throw new ErroHttp(401, "NAO_AUTENTICADO", "Faça login para continuar.");
    const { id } = z.object({ id: z.string().regex(/^[0-9a-f]{16}$/) }).parse(req.params);
    await db.update(sessoes).set({ revogada: true }).where(and(eq(sessoes.usuarioId, u.id), sql`left(${sessoes.id}, 16) = ${id}`));
    await auditar(db, req, "SESSAO_ENCERRADA", { tipo: "sessao", id });
    return { ok: true };
  });
}
