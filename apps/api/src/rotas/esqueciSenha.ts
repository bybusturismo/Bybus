import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { senhaTokens, sessoes, usuarios } from "../db/schema.js";
import { gerarHashSenha, validarPoliticaSenha } from "../seguranca/senha.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { criarEnvioEmail, emailConfigurado } from "../servicos/email.js";

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const VALIDADE_MIN = 60;

/**
 * "Esqueci minha senha" (pedido do dono, 09/11/2026: o link vai para o e-mail da pessoa, sem pedir ao administrador).
 * Rotas sem login — revisão de segurança:
 * - a resposta é sempre a mesma, exista ou não o e-mail (ninguém descobre quem tem conta);
 * - poucos pedidos por IP; o link vale 1 hora e uma vez só; pedir outro invalida o anterior;
 * - no banco fica só o hash do código; o endereço do link é sempre URL_PUBLICA (um Host falso não desvia o link);
 * - trocar a senha encerra as sessões abertas e destrava o acesso; o MFA continua valendo no próximo login.
 */
export async function rotasEsqueciSenha(app: FastifyInstance, { db, config }: Contexto) {
  const enviar = criarEnvioEmail(config);

  app.post("/api/auth/esqueci", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(200) }).parse(req.body);
    const resposta = { ok: true, mensagem: "Se este e-mail estiver cadastrado, enviamos um link para criar uma senha nova. Confira a caixa de entrada e o spam." };
    if (!emailConfigurado(config) || !config.URL_PUBLICA) {
      throw new ErroHttp(503, "EMAIL_NAO_CONFIGURADO", "O envio de e-mail ainda não está configurado. Fale com o administrador para redefinir a senha.");
    }
    const [u] = await db.select({ id: usuarios.id, nome: usuarios.nome, email: usuarios.email }).from(usuarios)
      .where(and(sql`lower(${usuarios.email}) = ${email}`, eq(usuarios.ativo, true)));
    if (!u) return resposta;
    const codigo = randomBytes(32).toString("base64url");
    await db.update(senhaTokens).set({ usadoEm: new Date() }).where(and(eq(senhaTokens.usuarioId, u.id), isNull(senhaTokens.usadoEm)));
    await db.insert(senhaTokens).values({ usuarioId: u.id, hash: hash(codigo), expiraEm: new Date(Date.now() + VALIDADE_MIN * 60_000) });
    const link = `${config.URL_PUBLICA.replace(/\/$/, "")}/redefinir-senha?c=${codigo}`;
    const nome = u.nome.split(/\s+/)[0] ?? "";
    try {
      await enviar({
        para: u.email, assunto: "Bybus Gestão: criar uma senha nova",
        texto: `Olá, ${nome}!\n\nRecebemos um pedido para criar uma senha nova no Bybus Gestão.\n\nCriar a senha: ${link}\n\n`
          + `O link vale por ${VALIDADE_MIN} minutos e só pode ser usado uma vez.\nSe você não pediu, ignore este e-mail: a sua senha atual continua valendo.\n\nBy Bus Turismo`,
      });
      await auditar(db, req, "SENHA_LINK_ENVIADO", { tipo: "usuario", id: u.id }, undefined, u.id);
    } catch (e) {
      req.log.warn({ erro: e instanceof Error ? e.name : "erro" }, "Falha ao enviar o e-mail de senha");
    }
    return resposta;
  });

  app.post("/api/auth/redefinir", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req) => {
    const { codigo, senha } = z.object({ codigo: z.string().min(20).max(100), senha: z.string().max(200) }).parse(req.body);
    const erro = validarPoliticaSenha(senha);
    if (erro) throw new ErroHttp(400, "SENHA_FRACA", erro);
    const [t] = await db.select({ id: senhaTokens.id, usuarioId: senhaTokens.usuarioId, email: usuarios.email }).from(senhaTokens)
      .innerJoin(usuarios, eq(usuarios.id, senhaTokens.usuarioId))
      .where(and(eq(senhaTokens.hash, hash(codigo)), isNull(senhaTokens.usadoEm), gt(senhaTokens.expiraEm, new Date()), eq(usuarios.ativo, true)));
    if (!t) throw new ErroHttp(400, "LINK_INVALIDO", "Este link expirou ou já foi usado. Peça um novo em “Esqueci minha senha”.");
    await db.update(usuarios).set({ senhaHash: await gerarHashSenha(senha), trocarSenha: false, tentativasFalhas: 0, bloqueios: 0, bloqueadoAte: null }).where(eq(usuarios.id, t.usuarioId));
    await db.update(senhaTokens).set({ usadoEm: new Date() }).where(and(eq(senhaTokens.usuarioId, t.usuarioId), isNull(senhaTokens.usadoEm)));
    await db.delete(sessoes).where(eq(sessoes.usuarioId, t.usuarioId));
    await auditar(db, req, "SENHA_REDEFINIDA_POR_EMAIL", { tipo: "usuario", id: t.usuarioId }, undefined, t.usuarioId);
    return { ok: true, email: t.email };
  });
}
