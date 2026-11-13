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
import { rotasEscala } from "./rotas/escala.js";
import { rotasEmbarque } from "./rotas/embarque.js";
import { rotasFechamento } from "./rotas/fechamento.js";
import { agendarFechamento } from "./servicos/fechamento.js";
import { rotasFinanceiro } from "./rotas/financeiro.js";
import { rotasRastreio } from "./rotas/rastreio.js";
import { rotasWhatsapp } from "./rotas/whatsapp.js";
import { rotasInstagram } from "./rotas/instagram.js";
import { rotasWhatsappMeta } from "./rotas/whatsappMeta.js";
import { rotasFichas } from "./rotas/fichas.js";
import { rotasEsqueciSenha } from "./rotas/esqueciSenha.js";
import { rotasCofre } from "./rotas/cofre.js";
import { rotasDocumentos } from "./rotas/documentos.js";
import { rotasConteudoPublicacao } from "./rotas/conteudo-publicacao.js";
import { agendarInstagram } from "./servicos/instagram/agendamento.js";
import { rotasVisaoGeral } from "./rotas/visao-geral.js";
import { rotasReservasLista } from "./rotas/reservas-lista.js";
import { rotasTransfer } from "./rotas/transfer.js";
import { agendarPaytour } from "./servicos/paytour.js";
import { rotasManifesto } from "./rotas/manifesto.js";
import { rotasOperacao } from "./rotas/operacao.js";
import { rotasUsuarios } from "./rotas/usuarios.js";
import { rotasPessoas } from "./rotas/pessoas.js";
import { rotasFrota } from "./rotas/frota.js";
import { rotasMarketing } from "./rotas/marketing.js";
import { rotasMarketingExtras } from "./rotas/marketing-extras.js";
import { agendarMarketing } from "./servicos/rotinasMarketing.js";
import { rotasBiblioteca } from "./rotas/biblioteca.js";
import { rotasIa } from "./rotas/ia.js";
import { agendarAvaliacaoIa } from "./servicos/ia/agendamento.js";
import { agendarLimpezaRastreio } from "./servicos/rastreio.js";
import { agendarTempo } from "./servicos/tempo.js";
import { rotasTempo } from "./rotas/tempo.js";
import { rotasAfiliadosComissao } from "./rotas/afiliadosComissao.js";
import { Cofre } from "./seguranca/cripto.js";
import { carregarUsuario, ErroHttp, nomeCookie } from "./seguranca/sessao.js";

export interface Contexto {
  db: Db;
  config: Config;
  cofre: Cofre;
}

/** Esconde tokens de links públicos na URL registrada no log. */
export const mascararUrl = (url: string) => url
  .replace(/(\/embarque\/)[A-Za-z0-9_-]+/g, "$1***")
  .replace(/(\/nps\/)[A-Za-z0-9_-]{20,}/g, "$1***")
  // O token do rastreio tem 20+ caracteres; rotas internas (/api/rastreio/saidas…) não são afetadas.
  .replace(/(\/rastreio\/)[A-Za-z0-9_-]{20,}/g, "$1***")
  .replace(/(\/api\/interno\/whatsapp\/)[A-Za-z0-9_-]+/g, "$1***")
  // Instagram: token de verificação do webhook (na query) e token da mídia agendada (na rota pública).
  .replace(/(hub\.verify_token=)[^&]*/g, "$1***")
  .replace(/(\/api\/publico\/instagram\/midia\/)[A-Za-z0-9_-]+/g, "$1***");

export async function criarApp(config: Config): Promise<{ app: FastifyInstance; fechar: () => Promise<void> }> {
  const { db, pool } = criarDb(config.DATABASE_URL);
  const ctx: Contexto = { db, config, cofre: new Cofre(config.CHAVE_CRIPTOGRAFIA) };

  const app = Fastify({
    logger: config.AMBIENTE === "testes" ? false : {
      level: "info",
      // Nunca registrar senha, código MFA, cookies ou documentos nos logs.
      redact: ["req.headers.cookie", "req.headers.authorization", "body.senha", "body.novaSenha", "body.senhaAtual", "body.codigo"],
      // O token do link de embarque vale como senha: não pode ir para o log junto da URL.
      serializers: {
        req: (r: { method: string; url: string; ip?: string }) => ({ method: r.method, url: mascararUrl(r.url), ip: r.ip }),
      },
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
    // O aviso da Evolution (rede interna) não é navegador: ele se protege pelo token na URL e pela recusa de X-Forwarded-For.
    if (req.url.startsWith("/api/interno/whatsapp/")) return;
    // Os avisos da Meta (Instagram e WhatsApp oficial) também não são navegador: protegem-se pela assinatura HMAC do corpo.
    if (req.url.startsWith("/api/webhooks/instagram") || req.url.startsWith("/api/webhooks/whatsapp")) return;
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
  await rotasEscala(app, ctx);
  await rotasEmbarque(app, ctx);
  await rotasFechamento(app, ctx);
  await rotasFrota(app, ctx);
  await rotasMarketing(app, ctx);
  await rotasMarketingExtras(app, ctx);
  await rotasBiblioteca(app, ctx);
  await rotasIa(app, ctx);
  await rotasFinanceiro(app, ctx);
  await rotasRastreio(app, ctx);
  await rotasWhatsapp(app, ctx);
  await rotasInstagram(app, ctx);
  await rotasWhatsappMeta(app, ctx);
  await rotasFichas(app, ctx);
  await rotasEsqueciSenha(app, ctx);
  await rotasCofre(app, ctx);
  await rotasDocumentos(app, ctx);
  await rotasConteudoPublicacao(app, ctx);
  await rotasVisaoGeral(app, ctx);
  await rotasReservasLista(app, ctx);
  await rotasTransfer(app, ctx);
  await rotasTempo(app, ctx);
  await rotasAfiliadosComissao(app, ctx);

  const pararPaytour = agendarPaytour(db, ctx.cofre, config, app.log);
  const pararFechamento = agendarFechamento(db, ctx.cofre, config, app.log);
  const pararIa = agendarAvaliacaoIa(db, config, app.log);
  const pararRastreio = agendarLimpezaRastreio(db, config, app.log);
  const pararInstagram = agendarInstagram(db, config, app.log);
  const pararMarketing = agendarMarketing(db, config, app.log);
  const pararTempo = agendarTempo(db, config, app.log);

  return { app, fechar: async () => { pararPaytour(); pararFechamento(); pararIa(); pararRastreio(); pararInstagram(); pararMarketing(); pararTempo(); await app.close(); await pool.end(); } };
}
