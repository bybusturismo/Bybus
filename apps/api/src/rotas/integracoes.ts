import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { lerEmailBokun, type ReservaImportada } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { deveAnonimizar } from "../config.js";
import { ErroHttp, exigir } from "../seguranca/sessao.js";
import { ClientePaytour, ErroPaytour, estadoPaytour, paytourConfigurada, sincronizarPaytour } from "../servicos/paytour.js";
import { importarReservas, USUARIO_INTEGRACAO } from "../servicos/importacao.js";

export type ResultadoEmail = "IMPORTADO" | "SEM_LEITOR" | "NAO_RECONHECIDO";

/** Escolhe o leitor pelo remetente/assunto. Decolar ainda não tem leitor (falta um e-mail de exemplo). */
export function lerEmailReserva(m: { remetente: string; assunto: string; corpo: string }): { resultado: ResultadoEmail; reserva?: ReservaImportada; canal?: string } {
  const de = m.remetente.toLowerCase();
  if (de.includes("bokun.io") || /^(new|cancelled|updated) booking/i.test(m.assunto)) {
    const r = lerEmailBokun(m.assunto, m.corpo);
    return r ? { resultado: "IMPORTADO", reserva: r, canal: "BOKUN" } : { resultado: "NAO_RECONHECIDO", canal: "BOKUN" };
  }
  if (de.includes("decolar") || de.includes("despegar")) return { resultado: "SEM_LEITOR", canal: "DECOLAR" };
  return { resultado: "NAO_RECONHECIDO" };
}

function tokenConfere(req: FastifyRequest, esperado: string): boolean {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const h = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(h(m[1]!), h(esperado));
}

export async function rotasIntegracoes(app: FastifyInstance, { db, config, cofre }: Contexto) {
  /**
   * Recebe e-mails de confirmação de reserva enviados pelo robô do Gmail (integracoes/gmail/Codigo.gs).
   * Idempotente: o mesmo e-mail (ou reserva) enviado de novo não duplica passageiros.
   */
  app.post("/api/integracoes/emails", { bodyLimit: 2 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    if (!config.INTEGRACAO_EMAIL_TOKEN) throw new ErroHttp(404, "NAO_ENCONTRADO", "Integração desligada.");
    if (!tokenConfere(req, config.INTEGRACAO_EMAIL_TOKEN)) throw new ErroHttp(401, "NAO_AUTORIZADO", "Token inválido.");
    const corpo = z.object({
      mensagens: z.array(z.object({
        id: z.string().min(1).max(200),
        remetente: z.string().max(500),
        assunto: z.string().max(1000).default(""),
        corpo: z.string().max(200_000),
      })).min(1).max(50),
    }).parse(req.body);

    const lidas = corpo.mensagens.map((m) => ({ id: m.id, ...lerEmailReserva(m) }));
    const reservas = lidas.flatMap((l) => (l.reserva ? [l.reserva] : []));
    const importacao = reservas.length
      ? await importarReservas(db, cofre, reservas, { confirmar: true, origem: "EMAIL_AUTOMATICO", usuario: USUARIO_INTEGRACAO, anonimizar: deveAnonimizar(config) })
      : null;
    const resumo = { mensagens: lidas.length, ...(importacao?.resumo ?? {}), semLeitor: lidas.filter((l) => l.resultado === "SEM_LEITOR").length, naoReconhecidas: lidas.filter((l) => l.resultado === "NAO_RECONHECIDO").length };
    await auditar(db, req, "IMPORTACAO_EMAIL_AUTOMATICA", { tipo: "importacao" }, resumo);
    // Devolve só o resultado por mensagem (o robô marca no Gmail o que já foi processado). Sem dados pessoais.
    return { resumo, mensagens: lidas.map((l) => ({ id: l.id, resultado: l.resultado, canal: l.canal ?? null })) };
  });

  const pre = { preHandler: exigir(config, "importacoes:executar") };
  const cliente = paytourConfigurada(config) ? new ClientePaytour({ url: config.PAYTOUR_URL, appKey: config.PAYTOUR_APP_KEY, appSecret: config.PAYTOUR_APP_SECRET }) : null;

  /** Situação da conexão com a Paytour (sem expor as credenciais). */
  app.get("/api/integracoes/paytour", pre, async () => {
    const e = await estadoPaytour(db);
    return {
      configurada: !!cliente,
      automaticaACadaMinutos: cliente ? config.PAYTOUR_SINCRONIZAR_MINUTOS : 0,
      ultimaExecucaoEm: e?.ultimaExecucaoEm ?? null,
      ultimoResultado: e?.ultimoResultado ?? null,
      ultimoErro: e?.ultimoErro ?? null,
    };
  });

  /** Sincroniza agora. `desde` (AAAA-MM-DD) relê a partir de uma data. */
  app.post("/api/integracoes/paytour/sincronizar", { ...pre, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req) => {
    if (!cliente) throw new ErroHttp(409, "PAYTOUR_NAO_CONFIGURADA", "Configure PAYTOUR_APP_KEY e PAYTOUR_APP_SECRET no servidor.");
    const corpo = z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body ?? {});
    try {
      const r = await sincronizarPaytour(db, cofre, config, cliente, corpo);
      await auditar(db, req, "SINCRONIZACAO_PAYTOUR_MANUAL", { tipo: "importacao" }, { pedidos: r.pedidos, ...r.resumo });
      return r;
    } catch (e) {
      if (e instanceof ErroPaytour) throw new ErroHttp(502, "PAYTOUR_FALHOU", e.message);
      throw e;
    }
  });
}
