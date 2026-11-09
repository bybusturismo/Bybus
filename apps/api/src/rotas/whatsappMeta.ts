import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { enviarModelosMeta, listarModelosMeta, metaConfigurada, processarAvisoMeta } from "../servicos/whatsappMeta.js";

const h = (t: string) => createHash("sha256").update(t).digest();
const iguais = (a: string, b: string) => timingSafeEqual(h(a), h(b));

/**
 * WhatsApp oficial (Meta). Revisão de segurança da rota pública (docs/produto/modulo-whatsapp.md):
 * - GET de verificação: só responde o desafio com a palavra combinada (META_WA_VERIFY_TOKEN); sem ela, 404.
 * - POST de avisos: só com a assinatura HMAC-SHA256 do segredo do app (META_APP_SECRET) sobre os bytes exatos do corpo; sem segredo, 404;
 *   assinatura errada, 401. Aceita só o número configurado. Nunca registra corpo, texto nem telefone.
 */
export async function rotasWhatsappMeta(app: FastifyInstance, { db, config }: Contexto) {
  await app.register(async (aviso) => {
    aviso.removeContentTypeParser("application/json");
    aviso.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 1024 * 1024 }, (_req, corpo, feito) => feito(null, corpo));

    aviso.get("/api/webhooks/whatsapp", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
      const esperado = config.META_WA_VERIFY_TOKEN;
      if (!esperado) return reply.status(404).send({ codigo: "NAO_ENCONTRADO", mensagem: "Não encontrado." });
      const q = req.query as Record<string, unknown>;
      const desafio = typeof q["hub.challenge"] === "string" ? q["hub.challenge"] : "";
      if (q["hub.mode"] !== "subscribe" || typeof q["hub.verify_token"] !== "string" || !iguais(q["hub.verify_token"], esperado) || !/^[\w-]{1,100}$/.test(desafio)) {
        return reply.status(403).send({ codigo: "RECUSADO", mensagem: "Verificação recusada." });
      }
      return reply.type("text/plain").send(desafio);
    });

    aviso.post("/api/webhooks/whatsapp", { bodyLimit: 1024 * 1024, config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } }, async (req, reply) => {
      const segredo = config.META_APP_SECRET;
      if (!segredo) return reply.status(404).send({ codigo: "NAO_ENCONTRADO", mensagem: "Não encontrado." });
      const cru = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const recebida = String(req.headers["x-hub-signature-256"] ?? "");
      const calculada = `sha256=${createHmac("sha256", segredo).update(cru).digest("hex")}`;
      if (!recebida || !iguais(recebida, calculada)) return reply.status(401).send({ codigo: "ASSINATURA_INVALIDA", mensagem: "Assinatura inválida." });
      let corpo: unknown;
      try { corpo = JSON.parse(cru.toString("utf8")); } catch { return reply.status(400).send({ codigo: "CORPO_INVALIDO", mensagem: "Corpo inválido." }); }
      await processarAvisoMeta(db, config, corpo);
      return { ok: true };
    });
  });

  // ---------- Modelos de mensagem (aprovação na Meta): quem cuida das integrações ----------
  const pre = { preHandler: exigir(config, "importacoes:executar") };
  const exigirMeta = () => {
    if (!metaConfigurada(config)) throw new ErroHttp(409, "META_NAO_CONFIGURADA", "WhatsApp oficial ainda não configurado no servidor (token e ID da conta do WhatsApp Business).");
  };

  app.get("/api/whatsapp/meta", pre, async () => {
    const base = {
      provedor: config.WHATSAPP_PROVEDOR, configurada: metaConfigurada(config), numeroConfigurado: !!config.META_WA_NUMERO_ID,
      avisosLigados: !!config.META_APP_SECRET && !!config.META_WA_VERIFY_TOKEN,
      enderecoAvisos: config.URL_PUBLICA ? `${config.URL_PUBLICA.replace(/\/$/, "")}/api/webhooks/whatsapp` : null,
    };
    if (!metaConfigurada(config)) return { ...base, modelos: [], erro: null };
    try {
      return { ...base, modelos: await listarModelosMeta(config), erro: null };
    } catch (e) {
      return { ...base, modelos: [], erro: e instanceof Error ? e.message : "erro" };
    }
  });

  app.post("/api/whatsapp/meta/modelos/enviar", { ...pre, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    exigirMeta();
    const r = await enviarModelosMeta(config);
    await auditar(db, req, "WHATSAPP_MODELOS_ENVIADOS", undefined, { enviados: r.enviados, erros: r.erros.map((e) => e.nome) });
    return r;
  });
}
