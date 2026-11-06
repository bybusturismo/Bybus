import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { passeios, pontosEmbarque, reservas, saidas, waConversas, waMensagens, type mensagens } from "../db/schema.js";
import { chaveTelefone, normalizarDestino } from "./whatsapp.js";

/**
 * Central de conversas do WhatsApp: guarda o que chega (avisos da Evolution) e o que sai (fila automática e respostas da tela).
 * LGPD: o texto das mensagens fica só no banco; nada de texto, telefone ou nome em log.
 */

export type Conversa = typeof waConversas.$inferSelect;
type StatusMensagem = "ENVIADA" | "SIMULADA" | "FALHA" | "RECEBIDA" | "LIDA";

/** Última situação da conexão informada pela Evolution (em memória; some ao reiniciar a API). */
export const conexaoEvolution: { estado: string | null; em: Date | null } = { estado: null, em: null };

const ehGrupoOuCanal = (jid: string) => /@(g\.us|broadcast|newsletter)$/.test(jid) || jid === "status@broadcast";

/** Telefone/endereço do contato a partir da chave da mensagem. Grupos, status e canais → null. */
export function contatoDaChave(key: { remoteJid?: unknown; remoteJidAlt?: unknown; senderPn?: unknown }): { telefone: string; jid: string } | null {
  const jid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  if (!jid || ehGrupoOuCanal(jid)) return null;
  const ehNumero = (v: unknown): v is string => typeof v === "string" && /@s\.whatsapp\.net$/.test(v);
  const origem = [jid, key.remoteJidAlt, key.senderPn].find(ehNumero);
  if (origem) {
    const digitos = origem.split("@")[0]!.replace(/\D/g, "");
    return { telefone: normalizarDestino(digitos) ?? digitos, jid };
  }
  // O WhatsApp às vezes esconde o número (endereço @lid): a conversa fica identificada pelo código.
  const codigo = jid.split("@")[0]!.replace(/[^A-Za-z0-9]/g, "");
  return codigo ? { telefone: `lid:${codigo}`, jid } : null;
}

export const chaveDaConversa = (telefone: string) => (telefone.startsWith("lid:") ? telefone : chaveTelefone(telefone));

const escapar = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Reservas confirmadas cujo telefone é o mesmo (DDI+DDD+8 últimos dígitos). `escopo` limita às praças do usuário. */
export async function reservasDoTelefone(db: Db, chave: string, escopo?: SQL, limite = 10) {
  if (chave.startsWith("lid:") || chave.startsWith("ig:") || chave.length < 8) return [];
  const linhas = await db.select({
    reservaId: reservas.id, saidaId: saidas.id, data: saidas.data, passeio: passeios.nome, unidadeId: passeios.unidadeId,
    titular: reservas.contatoNome, telefone: reservas.contatoTelefone, canal: reservas.canal, ponto: pontosEmbarque.nome, horario: pontosEmbarque.horario,
    passageiros: sql<number>`(select count(*)::int from passageiros p where p.reserva_id = ${reservas.id})`,
  }).from(reservas).innerJoin(saidas, eq(saidas.id, reservas.saidaId)).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).leftJoin(pontosEmbarque, eq(pontosEmbarque.id, reservas.pontoEmbarqueId))
    .where(and(
      eq(reservas.status, "CONFIRMADA"),
      sql`regexp_replace(coalesce(${reservas.contatoTelefone}, ''), '[^0-9]', '', 'g') like ${`%${chave.slice(-8)}`}`,
      escopo,
    )).orderBy(desc(saidas.data)).limit(40);
  return linhas
    .filter((l) => { const n = normalizarDestino(l.telefone); return !!n && chaveTelefone(n) === chave; })
    .slice(0, limite)
    .map(({ telefone: _t, ...r }) => r);
}

/** Liga a conversa a uma praça (e ao nome do titular, se faltar) pela reserva mais próxima de hoje. */
export async function vincularUnidade(db: Db, conversa: Conversa): Promise<Conversa> {
  if (conversa.unidadeId) return conversa;
  const achadas = await reservasDoTelefone(db, conversa.chave, undefined, 40);
  if (!achadas.length) return conversa;
  const hoje = Date.now();
  const alvo = [...achadas].sort((a, b) => Math.abs(Date.parse(a.data) - hoje) - Math.abs(Date.parse(b.data) - hoje))[0]!;
  const [atual] = await db.update(waConversas).set({ unidadeId: alvo.unidadeId, nome: conversa.nome ?? alvo.titular }).where(eq(waConversas.id, conversa.id)).returning();
  return atual ?? conversa;
}

/** Acha (pela chave ou pelo JID) ou cria a conversa do telefone. `nome` atualiza o nome exibido. */
export async function obterConversa(db: Db, c: { telefone: string; jid?: string | null; nome?: string | null }): Promise<Conversa> {
  const chave = chaveDaConversa(c.telefone);
  let conversa = (await db.select().from(waConversas).where(eq(waConversas.chave, chave)))[0];
  if (!conversa && c.jid) conversa = (await db.select().from(waConversas).where(eq(waConversas.jid, c.jid)))[0];
  if (!conversa) {
    await db.insert(waConversas).values({ telefone: c.telefone, chave, jid: c.jid ?? null, nome: c.nome?.trim() || null }).onConflictDoNothing();
    conversa = (await db.select().from(waConversas).where(eq(waConversas.chave, chave)))[0]!;
  } else {
    const mudancas: Partial<Conversa> = {};
    if (c.jid && c.jid !== conversa.jid) mudancas.jid = c.jid;
    if (c.nome?.trim() && c.nome.trim() !== conversa.nome) mudancas.nome = c.nome.trim();
    if (Object.keys(mudancas).length) conversa = (await db.update(waConversas).set(mudancas).where(eq(waConversas.id, conversa.id)).returning())[0] ?? conversa;
  }
  return vincularUnidade(db, conversa);
}

export async function tocarConversa(db: Db, id: string, quando: Date, entrada: boolean) {
  const q = quando.toISOString();
  await db.update(waConversas).set({
    ultimaMensagemEm: sql`greatest(coalesce(${waConversas.ultimaMensagemEm}, ${q}::timestamptz), ${q}::timestamptz)`,
    ...(entrada ? {
      naoLidas: sql`${waConversas.naoLidas} + 1`,
      // A janela de 24 h do Instagram conta da última mensagem do cliente.
      ultimaEntradaEm: sql`greatest(coalesce(${waConversas.ultimaEntradaEm}, ${q}::timestamptz), ${q}::timestamptz)`,
    } : {}),
  }).where(eq(waConversas.id, id));
}

/** Acha ou cria a conversa de Instagram do contato (IGSID). O nome só preenche se ainda faltar. */
export async function obterConversaInstagram(db: Db, c: { idContato: string; nome?: string | null }): Promise<Conversa> {
  const chave = `ig:${c.idContato}`;
  await db.insert(waConversas).values({ canal: "INSTAGRAM", telefone: chave, chave, idContato: c.idContato, nome: c.nome?.trim() || null }).onConflictDoNothing();
  let conversa = (await db.select().from(waConversas).where(eq(waConversas.chave, chave)))[0]!;
  if (c.nome?.trim() && !conversa.nome) conversa = (await db.update(waConversas).set({ nome: c.nome.trim() }).where(eq(waConversas.id, conversa.id)).returning())[0] ?? conversa;
  return conversa;
}

interface NovaSaida { conversaId: string; texto: string; tipo?: string; status: StatusMensagem; idExterno?: string | null; enviadaPor?: string | null; mensagemFilaId?: string | null; quando?: Date }

/** Grava uma mensagem nossa. Se o aviso da Evolution (ou a fila, numa nova tentativa) já registrou a mesma, só completa/atualiza. */
export async function gravarSaida(db: Db, v: NovaSaida) {
  const onde: SQL[] = [];
  if (v.idExterno) onde.push(eq(waMensagens.idExterno, v.idExterno));
  if (v.mensagemFilaId) onde.push(eq(waMensagens.mensagemFilaId, v.mensagemFilaId));
  for (const cond of onde) {
    const [existente] = await db.select().from(waMensagens).where(cond);
    if (!existente) continue;
    const [atual] = await db.update(waMensagens).set({
      status: existente.status === "LIDA" && v.status !== "FALHA" ? "LIDA" : v.status,
      idExterno: existente.idExterno ?? v.idExterno ?? null,
      mensagemFilaId: existente.mensagemFilaId ?? v.mensagemFilaId ?? null,
      enviadaPor: existente.enviadaPor ?? v.enviadaPor ?? null,
    }).where(eq(waMensagens.id, existente.id)).returning();
    return atual!;
  }
  const quando = v.quando ?? new Date();
  const [nova] = await db.insert(waMensagens).values({
    conversaId: v.conversaId, direcao: "SAIDA", texto: v.texto, tipo: v.tipo ?? "TEXTO", status: v.status,
    idExterno: v.idExterno ?? null, enviadaPor: v.enviadaPor ?? null, mensagemFilaId: v.mensagemFilaId ?? null, criadoEm: quando,
  }).onConflictDoNothing().returning();
  if (nova) await tocarConversa(db, v.conversaId, quando, false);
  return nova ?? null;
}

/** Mensagem da fila automática (confirmação, voucher, rastreio) → conversa do destinatário. Grupo (lista das 21h) fica de fora. */
export async function registrarSaidaFila(db: Db, m: typeof mensagens.$inferSelect, r: { status: "ENVIADA" | "SIMULADA" | "FALHA"; idExterno?: string }) {
  if (!m.destino || m.destino.endsWith("@g.us")) return;
  try {
    const conversa = await obterConversa(db, { telefone: m.destino });
    await gravarSaida(db, { conversaId: conversa.id, texto: m.texto, status: r.status, idExterno: r.idExterno, mensagemFilaId: m.id });
  } catch (e) {
    // Nunca derruba o envio da fila; sem texto nem telefone no registro (LGPD).
    console.error("[whatsapp] falha ao registrar a mensagem da fila na conversa:", e instanceof Error ? e.name : "erro");
  }
}

// ---------------------------------------------------------------- avisos da Evolution

interface ResumoMensagem { tipo: string; texto: string | null }

/** O que mostrar de uma mensagem recebida (formato do WhatsApp Web). Avisos internos e reações → null (ignorar). */
export function resumirMensagem(dados: { message?: unknown }): ResumoMensagem | null {
  let m = (dados.message ?? {}) as Record<string, any>;
  for (let i = 0; i < 3; i++) {
    const dentro = m.ephemeralMessage ?? m.viewOnceMessage ?? m.viewOnceMessageV2 ?? m.documentWithCaptionMessage ?? m.editedMessage;
    if (!dentro?.message) break;
    m = dentro.message;
  }
  const limitar = (t: unknown) => (typeof t === "string" && t ? t.slice(0, 4096) : null);
  if (typeof m.conversation === "string") return { tipo: "TEXTO", texto: limitar(m.conversation) };
  if (m.extendedTextMessage) return { tipo: "TEXTO", texto: limitar(m.extendedTextMessage.text) };
  if (m.imageMessage) return { tipo: "IMAGEM", texto: limitar(m.imageMessage.caption) };
  if (m.audioMessage) return { tipo: "AUDIO", texto: null };
  if (m.documentMessage) return { tipo: "DOCUMENTO", texto: limitar(m.documentMessage.caption ?? m.documentMessage.fileName) };
  if (m.videoMessage) return { tipo: "OUTRO", texto: limitar(m.videoMessage.caption) ?? "Vídeo" };
  if (m.stickerMessage) return { tipo: "OUTRO", texto: "Figurinha" };
  const lugar = m.locationMessage ?? m.liveLocationMessage;
  if (lugar) return { tipo: "OUTRO", texto: limitar(`Localização compartilhada ${lugar.name ?? ""} ${lugar.address ?? ""}`.replace(/\s+/g, " ").trim()) };
  if (m.contactMessage) return { tipo: "OUTRO", texto: "Contato compartilhado" };
  if (m.buttonsResponseMessage) return { tipo: "TEXTO", texto: limitar(m.buttonsResponseMessage.selectedDisplayText) };
  if (m.listResponseMessage) return { tipo: "TEXTO", texto: limitar(m.listResponseMessage.title) };
  if (m.reactionMessage || m.protocolMessage || m.senderKeyDistributionMessage || Object.keys(m).every((k) => k === "messageContextInfo")) return null;
  return { tipo: "OUTRO", texto: "Mensagem de um tipo que o sistema ainda não mostra" };
}

async function receberMensagem(db: Db, d: Record<string, any>) {
  const key = (d.key ?? {}) as Record<string, unknown>;
  const contato = contatoDaChave(key);
  const idExterno = typeof key.id === "string" ? key.id.slice(0, 200) : "";
  if (!contato || !idExterno) return false;
  const resumo = resumirMensagem(d);
  if (!resumo) return false;
  const minha = key.fromMe === true;
  const ts = Number(d.messageTimestamp);
  const quando = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date();
  const conversa = await obterConversa(db, { ...contato, nome: minha ? null : typeof d.pushName === "string" ? d.pushName.slice(0, 120) : null });
  if (minha) {
    // Enviada por nós (a resposta da tela e a fila já gravaram a mesma; aqui entram as enviadas pelo celular).
    await gravarSaida(db, { conversaId: conversa.id, texto: resumo.texto ?? "", tipo: resumo.tipo, status: "ENVIADA", idExterno, quando });
    return true;
  }
  const [nova] = await db.insert(waMensagens).values({
    conversaId: conversa.id, direcao: "ENTRADA", texto: resumo.texto, tipo: resumo.tipo, status: "RECEBIDA", idExterno, criadoEm: quando,
  }).onConflictDoNothing().returning();
  if (nova) await tocarConversa(db, conversa.id, quando, true);
  return !!nova;
}

/** Estados da Evolution → nosso status. Só avança (ENVIADA → LIDA); FALHA sempre grava. */
async function atualizarStatus(db: Db, idExterno: string, statusEvolution: unknown) {
  const s = String(statusEvolution ?? "").toUpperCase();
  const novo = s === "READ" || s === "PLAYED" ? "LIDA" : s === "ERROR" ? "FALHA" : null;
  if (!novo) return;
  await db.update(waMensagens).set({ status: novo }).where(and(
    eq(waMensagens.idExterno, idExterno), eq(waMensagens.direcao, "SAIDA"),
    novo === "FALHA" ? sql`${waMensagens.status} <> 'LIDA'` : sql`${waMensagens.status} in ('ENVIADA')`,
  ));
}

/**
 * Processa um aviso da Evolution. Só três eventos entram: messages.upsert, messages.update e connection.update;
 * qualquer outro é ignorado. Devolve o que fez (para teste) — nunca texto de mensagem.
 */
export async function processarAviso(db: Db, config: Config, corpo: unknown): Promise<{ evento: string; gravadas: number }> {
  const b = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, any>;
  const evento = String(b.event ?? "").toLowerCase().replace(/_/g, ".");
  if (typeof b.instance === "string" && b.instance !== config.EVOLUTION_INSTANCIA) return { evento: "outra-instancia", gravadas: 0 };
  const itens: Array<Record<string, any>> = (Array.isArray(b.data) ? b.data : [b.data ?? {}]).filter((x: unknown) => x && typeof x === "object");
  let gravadas = 0;
  for (const d of itens) {
    try {
      if (evento === "messages.upsert") { if (await receberMensagem(db, d)) gravadas++; }
      else if (evento === "messages.update") {
        const id = d.keyId ?? d.key?.id;
        if (typeof id === "string") await atualizarStatus(db, id, d.status);
      } else if (evento === "connection.update") {
        const estado = d.state ?? d.status;
        if (typeof estado === "string") { conexaoEvolution.estado = estado.slice(0, 30); conexaoEvolution.em = new Date(); }
      }
    } catch (e) {
      console.error("[whatsapp] falha ao processar aviso", evento, e instanceof Error ? e.name : "erro");
    }
  }
  return { evento, gravadas };
}
