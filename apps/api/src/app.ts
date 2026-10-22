import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import { criarDb, type Db } from "./db/cliente.js";
import { rotasAuth } from "./rotas/auth.js";
import { rotasImportacao } from "./rotas/importacao.js";
import { rotasIntegracoes } from "./rotas/integracoes.js";
import { rotasManifesto } from "./rotas/manifesto.js";
import { rotasOperacao } from "./rotas/operacao.js";
import { rotasUsuarios } from "./rotas/usuarios.js";
import { rotasPessoas } from "./rotas/pessoas.js";
import { Cofre } from "./seguranca/cripto.js";
import { carregarUsuario, ErroHttp, nomeCookie } from "./seguranca/sessao.js";

export interface Contexto {
  db: Db;
  config: Config;
  cofre: Cofre;
}

export async function criarApp(config: Config): Promise<{ app: FastifyInstance; fechar: () => Promise<void> }> {
  const { db, pool } = criarDb(config.DATABASE_URL);
  const ctx: Contexto = { db, config, cofre: new Cofre(config.CHAVE_CRIPTOGRAFIA) };

  const app = Fastify({
    logger: config.AMBIENTE === "testes" ? false : {
      level: "info",
      // Nunca registrar senha, código MFA, cookies ou documentos nos logs.
      redact: ["req.headers.cookie", "req.headers.authorization", "body.senha", "body.novaSenha", "body.senhaAtual", "body.codigo"],
    },
    // Só confia em X-Forwarded-For quando há proxy conhecido à frente (evita IP falsificado no rate limit e na auditoria).
    trustProxy: config.PROXIES_CONFIAVEIS > 0 ? config.PROXIES_CONFIAVEIS : false,
    bodyLimit: 1024 * 1024,
  });

  await app.register(helmet, {
    // API só devolve JSON/CSV: nada deve ser executado nem embutido.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  // Proteção CSRF: toda requisição que altera dados precisa do cabeçalho X-Bybus (navegadores não o enviam em ataques cross-site).
  app.addHook("onRequest", async (req) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-bybus"] !== "1") {
      throw new ErroHttp(403, "CSRF", "Requisição bloqueada.");
    }
  });

  app.addHook("preHandler", async (req) => {
    req.usuario = (await carregarUsuario(db, config, req.cookies[nomeCookie(config)])) ?? undefined;
  });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", reply.getHeader("Cache-Control") ?? "no-store");
  });

  app.setErrorHandler((erro, req, reply) => {
    if (erro instanceof ErroHttp) return reply.status(erro.status).send({ codigo: erro.codigo, mensagem: erro.message });
    if (erro instanceof ZodError) {
      return reply.status(400).send({ codigo: "DADOS_INVALIDOS", mensagem: "Dados inválidos.", detalhes: erro.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })) });
    }
    const status = (erro as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ codigo: "MUITAS_REQUISICOES", mensagem: "Muitas tentativas. Aguarde um pouco." });
    if (status && status >= 400 && status < 500) return reply.status(status).send({ codigo: "REQUISICAO_INVALIDA", mensagem: status === 413 ? "Arquivo ou conteúdo grande demais." : "Requisição inválida." });
    req.log.error(erro);
    return reply.status(500).send({ codigo: "ERRO_INTERNO", mensagem: "Erro interno. Tente novamente." });
  });

  app.get("/api/saude", async () => ({ ok: true }));

  await rotasAuth(app, ctx);
  await rotasUsuarios(app, ctx);
  await rotasPessoas(app, ctx);
  await rotasOperacao(app, ctx);
  await rotasManifesto(app, ctx);
  await rotasImportacao(app, ctx);
  await rotasIntegracoes(app, ctx);

  return { app, fechar: async () => { await app.close(); await pool.end(); } };
}
