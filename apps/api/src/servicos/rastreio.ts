import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { compararPontos, modeloRastreio, textoRastreio } from "@bybus/core";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { mensagens, pontosEmbarque, rastreioLinks, rastreioPosicoes, rastreioSessoes, reservas, saidas } from "../db/schema.js";
import { agoraSp, enfileirarMensagem } from "./fechamento.js";
import { hashToken } from "./linkEmbarque.js";

/** Posições guardadas por no máximo 30 dias (LGPD: a localização do motorista só existe em serviço). */
export const RETENCAO_POSICOES_DIAS = 30;

/** Expiração do link: fim do dia do passeio em Brasília (03:00 UTC do dia seguinte). */
export const fimDoDia = (data: string) => new Date(new Date(`${data}T03:00:00Z`).getTime() + 86_400_000);

/** Pontos ativos do passeio na ordem da rota (horário, depois ordem oficial). */
export async function pontosDaRota(db: Db, passeioId: string) {
  const lista = await db.select().from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, passeioId), eq(pontosEmbarque.ativo, true))).orderBy(asc(pontosEmbarque.ordem));
  return lista.sort(compararPontos);
}

export const coordenadaDe = (p: { latitude: number | null; longitude: number | null }) => (p.latitude !== null && p.longitude !== null ? { lat: p.latitude, lng: p.longitude } : null);

export async function ultimaSessao(db: Db, saidaId: string) {
  const [s] = await db.select().from(rastreioSessoes).where(eq(rastreioSessoes.saidaId, saidaId)).orderBy(desc(rastreioSessoes.iniciadaEm)).limit(1);
  return s ?? null;
}

/**
 * Cria (ou troca) o link de acompanhamento da reserva. O token vai só na mensagem; o banco guarda o hash.
 * Refazer o link invalida o anterior.
 */
export async function gerarLinkRastreio(db: Db, reservaId: string, data: string) {
  const token = randomBytes(24).toString("base64url");
  const expiraEm = fimDoDia(data);
  await db.insert(rastreioLinks).values({ reservaId, tokenHash: hashToken(token), expiraEm })
    .onConflictDoUpdate({ target: rastreioLinks.reservaId, set: { tokenHash: hashToken(token), expiraEm } });
  return token;
}

/**
 * Ao iniciar o rastreio: enfileira a mensagem RASTREIO (uma por reserva confirmada; respeita o modo simulado).
 * Reiniciar o rastreio no mesmo dia não reenvia nem troca o link já enviado.
 * Sem URL pública configurada não há como montar o link: nada é enfileirado.
 */
export async function enviarLinksRastreio(db: Db, config: Config, saida: { id: string; data: string }, passeioNome: string) {
  if (!config.URL_PUBLICA) return { enfileiradas: 0, semUrlPublica: true };
  const base = config.URL_PUBLICA.replace(/\/$/, "");
  const ativas = await db.select().from(reservas).where(and(eq(reservas.saidaId, saida.id), eq(reservas.status, "CONFIRMADA")));
  const jaTem = new Set((await db.select({ id: mensagens.reservaId }).from(mensagens).where(and(eq(mensagens.saidaId, saida.id), eq(mensagens.tipo, "RASTREIO")))).map((m) => m.id));
  // Quem já recebeu o link do mapa na confirmação da véspera não recebe outra mensagem (o dono paga por mensagem).
  const ids = ativas.map((r) => r.id);
  if (ids.length) for (const l of await db.select({ id: rastreioLinks.reservaId }).from(rastreioLinks).where(inArray(rastreioLinks.reservaId, ids))) jaTem.add(l.id);
  let enfileiradas = 0;
  for (const r of ativas) {
    if (jaTem.has(r.id)) continue;
    const token = await gerarLinkRastreio(db, r.id, saida.data);
    const m = await enfileirarMensagem(db, config, {
      tipo: "RASTREIO", reservaId: r.id, saidaId: saida.id, destino: r.contatoTelefone,
      texto: textoRastreio({ primeiroNome: r.contatoNome.split(/[\s,]+/).filter(Boolean)[0] ?? "", passeio: passeioNome, link: `${base}/rastreio/${token}` }),
      modelo: modeloRastreio({ primeiroNome: r.contatoNome.split(/[\s,]+/).filter(Boolean)[0] ?? "", passeio: passeioNome, link: `${base}/rastreio/${token}` }),
    });
    if (m) enfileiradas++;
  }
  return { enfileiradas, semUrlPublica: false };
}

/**
 * Limpeza: encerra sessões esquecidas abertas de dias anteriores e apaga posições com mais de 30 dias.
 * Roda de hora em hora (barata), então a retenção é aplicada todo dia.
 */
export async function limparRastreio(db: Db, agora = new Date()) {
  const { hoje } = agoraSp(agora);
  const abertas = await db.select({ id: rastreioSessoes.id, data: saidas.data }).from(rastreioSessoes)
    .innerJoin(saidas, eq(saidas.id, rastreioSessoes.saidaId)).where(isNull(rastreioSessoes.encerradaEm));
  let encerradas = 0;
  for (const s of abertas) {
    if (s.data < hoje) {
      await db.update(rastreioSessoes).set({ encerradaEm: agora }).where(eq(rastreioSessoes.id, s.id));
      encerradas++;
    }
  }
  const corte = new Date(agora.getTime() - RETENCAO_POSICOES_DIAS * 86_400_000);
  const apagadas = await db.delete(rastreioPosicoes).where(lt(rastreioPosicoes.registradaEm, corte)).returning({ id: rastreioPosicoes.id });
  await db.delete(rastreioLinks).where(lt(rastreioLinks.expiraEm, corte));
  return { encerradas, apagadas: apagadas.length };
}

export function agendarLimpezaRastreio(db: Db, config: Config, log: { error: (o: unknown, m: string) => void; info: (o: unknown, m: string) => void }): () => void {
  if (config.AMBIENTE === "testes") return () => {};
  const rodar = () => limparRastreio(db).then((r) => { if (r.encerradas || r.apagadas) log.info(r, "Limpeza do rastreio"); }).catch((e) => log.error({ erro: e instanceof Error ? e.message : e }, "Falha na limpeza do rastreio"));
  const inicio = setTimeout(rodar, 30_000);
  const intervalo = setInterval(rodar, 3_600_000);
  return () => { clearTimeout(inicio); clearInterval(intervalo); };
}
