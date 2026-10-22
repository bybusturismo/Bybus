import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { lerEmailBokun, type ReservaImportada } from "@bybus/core";
import { z } from "zod";
import { auditar } from "../auditoria.js";
import type { Contexto } from "../app.js";
import { ErroHttp } from "../seguranca/sessao.js";
import type { UsuarioSessao } from "../seguranca/sessao.js";
import { importarReservas } from "../servicos/importacao.js";

/** "Usuário" das importações automáticas: alcança todas as praças, sem sessão nem login. */
const ROBO_EMAIL: UsuarioSessao = {
  id: "integracao-email", nome: "Integração de e-mails", email: "", perfil: "INTEGRACAO", perfilNome: "Integração",
  permissoes: ["importacoes:executar"], todasUnidades: true, unidadeIds: [], trocarSenha: false, totpAtivo: false, sessaoId: "",
};

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
      ? await importarReservas(db, cofre, reservas, { confirmar: true, origem: "EMAIL_AUTOMATICO", usuario: ROBO_EMAIL, anonimizar: config.AMBIENTE !== "producao" })
      : null;
    const resumo = { mensagens: lidas.length, ...(importacao?.resumo ?? {}), semLeitor: lidas.filter((l) => l.resultado === "SEM_LEITOR").length, naoReconhecidas: lidas.filter((l) => l.resultado === "NAO_RECONHECIDO").length };
    await auditar(db, req, "IMPORTACAO_EMAIL_AUTOMATICA", { tipo: "importacao" }, resumo);
    // Devolve só o resultado por mensagem (o robô marca no Gmail o que já foi processado). Sem dados pessoais.
    return { resumo, mensagens: lidas.map((l) => ({ id: l.id, resultado: l.resultado, canal: l.canal ?? null })) };
  });
}
