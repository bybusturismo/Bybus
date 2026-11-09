import { and, eq, sql } from "drizzle-orm";
import { MODELOS_META } from "@bybus/core";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { mensagens, waMensagens } from "../db/schema.js";
import { gravarSaida, obterConversa, tocarConversa } from "./whatsappConversas.js";
import { normalizarDestino } from "./whatsapp.js";

/**
 * WhatsApp oficial (Meta Cloud API, ADR 0010): avisos recebidos (mensagens dos clientes e status das nossas) e
 * modelos de mensagem (lista e envio para aprovação). Nunca registra texto nem telefone (LGPD).
 */

const limitar = (t: unknown) => (typeof t === "string" && t ? t.slice(0, 4096) : null);

/** O que mostrar de uma mensagem recebida da Meta. Reações e avisos do sistema → null (ignorar). */
export function resumirMensagemMeta(m: Record<string, any>): { tipo: string; texto: string | null } | null {
  switch (m.type) {
    case "text": return { tipo: "TEXTO", texto: limitar(m.text?.body) };
    case "image": return { tipo: "IMAGEM", texto: limitar(m.image?.caption) };
    case "audio": return { tipo: "AUDIO", texto: null };
    case "document": return { tipo: "DOCUMENTO", texto: limitar(m.document?.caption ?? m.document?.filename) };
    case "video": return { tipo: "OUTRO", texto: limitar(m.video?.caption) ?? "Vídeo" };
    case "sticker": return { tipo: "OUTRO", texto: "Figurinha" };
    case "location": return { tipo: "OUTRO", texto: limitar(`Localização compartilhada ${m.location?.name ?? ""} ${m.location?.address ?? ""}`.replace(/\s+/g, " ").trim()) };
    case "contacts": return { tipo: "OUTRO", texto: "Contato compartilhado" };
    case "button": return { tipo: "TEXTO", texto: limitar(m.button?.text) };
    case "interactive": return { tipo: "TEXTO", texto: limitar(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title) };
    case "reaction": case "system": case "ephemeral": return null;
    default: return { tipo: "OUTRO", texto: "Mensagem de um tipo que o sistema ainda não mostra" };
  }
}

/** Status da Meta → nosso. Só avança (ENVIADA → LIDA); FALHA sempre grava (menos sobre LIDA). */
async function atualizarStatusMeta(db: Db, s: Record<string, any>) {
  const id = typeof s.id === "string" ? s.id.slice(0, 200) : null;
  const novo = s.status === "read" ? "LIDA" : s.status === "failed" ? "FALHA" : null;
  if (!id || !novo) return;
  const [w] = await db.update(waMensagens).set({ status: novo }).where(and(
    eq(waMensagens.idExterno, id), eq(waMensagens.direcao, "SAIDA"),
    novo === "FALHA" ? sql`${waMensagens.status} <> 'LIDA'` : sql`${waMensagens.status} in ('ENVIADA')`,
  )).returning({ filaId: waMensagens.mensagemFilaId });
  // Falha na entrega de mensagem da fila (ex.: número sem WhatsApp, modelo pausado): aparece em "Mensagens" da saída.
  if (novo === "FALHA" && w?.filaId) {
    const codigo = Array.isArray(s.errors) && s.errors[0]?.code ? String(s.errors[0].code).slice(0, 12) : "?";
    await db.update(mensagens).set({ status: "FALHA", erro: `META ${codigo}` }).where(eq(mensagens.id, w.filaId));
  }
}

async function receberMensagemMeta(db: Db, m: Record<string, any>, nomes: Map<string, string>) {
  const telefone = normalizarDestino(typeof m.from === "string" ? m.from : null);
  const idExterno = typeof m.id === "string" ? m.id.slice(0, 200) : "";
  if (!telefone || !idExterno) return false;
  const resumo = resumirMensagemMeta(m);
  if (!resumo) return false;
  const ts = Number(m.timestamp);
  const quando = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date();
  const conversa = await obterConversa(db, { telefone, nome: nomes.get(m.from)?.slice(0, 120) ?? null });
  const [nova] = await db.insert(waMensagens).values({
    conversaId: conversa.id, direcao: "ENTRADA", texto: resumo.texto, tipo: resumo.tipo, status: "RECEBIDA", idExterno, criadoEm: quando,
  }).onConflictDoNothing().returning();
  // tocarConversa(…, entrada) também abre a janela de 24 h (texto livre permitido).
  if (nova) await tocarConversa(db, conversa.id, quando, true);
  return !!nova;
}

/**
 * Coexistência (o número continua no WhatsApp Business do celular, decisão do dono em 09/11/2026): o que a equipe manda pelo
 * celular chega como "eco" e entra na conversa como mensagem nossa.
 */
async function receberEcoMeta(db: Db, e: Record<string, any>) {
  const telefone = normalizarDestino(typeof e.to === "string" ? e.to : null);
  const idExterno = typeof e.id === "string" ? e.id.slice(0, 200) : "";
  const resumo = resumirMensagemMeta(e);
  if (!telefone || !idExterno || !resumo) return false;
  const ts = Number(e.timestamp);
  const conversa = await obterConversa(db, { telefone });
  await gravarSaida(db, { conversaId: conversa.id, texto: resumo.texto ?? "", tipo: resumo.tipo, status: "ENVIADA", idExterno, quando: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date() });
  return true;
}

/** Processa o aviso da Meta (já com a assinatura conferida). Só o número configurado; o resto é ignorado. */
export async function processarAvisoMeta(db: Db, config: Config, corpo: unknown): Promise<{ gravadas: number; status: number }> {
  const b = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, any>;
  let gravadas = 0;
  let status = 0;
  if (b.object !== "whatsapp_business_account" || !Array.isArray(b.entry)) return { gravadas, status };
  for (const e of b.entry) {
    for (const ch of Array.isArray(e?.changes) ? e.changes : []) {
      const v = ch?.value;
      if (!v || v.metadata?.phone_number_id !== config.META_WA_NUMERO_ID) continue;
      if (ch?.field === "smb_message_echoes") {
        for (const e of Array.isArray(v.message_echoes) ? v.message_echoes : []) {
          try { if (await receberEcoMeta(db, e)) gravadas++; } catch (x) { console.error("[whatsapp-meta] falha ao gravar eco:", x instanceof Error ? x.name : "erro"); }
        }
        continue;
      }
      if (ch?.field !== "messages") continue;
      const nomes = new Map<string, string>();
      for (const c of Array.isArray(v.contacts) ? v.contacts : []) if (typeof c?.wa_id === "string" && typeof c?.profile?.name === "string") nomes.set(c.wa_id, c.profile.name);
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        try { if (await receberMensagemMeta(db, m, nomes)) gravadas++; } catch (x) { console.error("[whatsapp-meta] falha ao gravar mensagem:", x instanceof Error ? x.name : "erro"); }
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        try { await atualizarStatusMeta(db, s); status++; } catch (x) { console.error("[whatsapp-meta] falha ao atualizar status:", x instanceof Error ? x.name : "erro"); }
      }
    }
  }
  return { gravadas, status };
}

// ---------------------------------------------------------------- modelos (aprovação na Meta)

const graph = (c: Config, caminho: string) => `${c.META_GRAPH_URL.replace(/\/$/, "")}/${c.META_API_VERSAO}/${caminho}`;
export const metaConfigurada = (c: Config) => !!c.META_WA_TOKEN && !!c.META_WA_CONTA_ID;

export interface SituacaoModelo { nome: string; descricao: string; status: string; motivo: string | null }

/** Situação de cada modelo do sistema na Meta (APPROVED, PENDING, REJECTED, PAUSED… ou NAO_ENVIADO). */
export async function listarModelosMeta(c: Config, buscar: typeof fetch = fetch): Promise<SituacaoModelo[]> {
  const r = await buscar(`${graph(c, `${c.META_WA_CONTA_ID}/message_templates`)}?fields=name,status,language,rejected_reason&limit=200`, {
    headers: { Authorization: `Bearer ${c.META_WA_TOKEN}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`META_HTTP_${r.status}`);
  const j = (await r.json()) as { data?: Array<{ name?: string; status?: string; language?: string; rejected_reason?: string }> };
  return MODELOS_META.map((m) => {
    const x = (j.data ?? []).find((d) => d.name === m.nome && d.language === m.idioma);
    return { nome: m.nome, descricao: m.descricao, status: x?.status ?? "NAO_ENVIADO", motivo: x?.rejected_reason && x.rejected_reason !== "NONE" ? x.rejected_reason : null };
  });
}

/** Envia para aprovação os modelos que ainda não existem na conta (os já enviados não são reenviados). */
export async function enviarModelosMeta(c: Config, buscar: typeof fetch = fetch): Promise<{ enviados: string[]; erros: Array<{ nome: string; erro: string }> }> {
  const atuais = await listarModelosMeta(c, buscar);
  const enviados: string[] = [];
  const erros: Array<{ nome: string; erro: string }> = [];
  for (const m of MODELOS_META) {
    if (atuais.find((a) => a.nome === m.nome)?.status !== "NAO_ENVIADO") continue;
    const r = await buscar(graph(c, `${c.META_WA_CONTA_ID}/message_templates`), {
      method: "POST",
      headers: { Authorization: `Bearer ${c.META_WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: m.nome, language: m.idioma, category: m.categoria, components: [{ type: "BODY", text: m.corpo, example: { body_text: [m.exemplo] } }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.ok) enviados.push(m.nome);
    else {
      const j = (await r.json().catch(() => null)) as { error?: { error_user_msg?: string; message?: string } } | null;
      erros.push({ nome: m.nome, erro: (j?.error?.error_user_msg ?? j?.error?.message ?? `HTTP ${r.status}`).slice(0, 300) });
    }
  }
  return { enviados, erros };
}
