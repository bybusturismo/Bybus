import { and, eq, sql } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Db } from "../../db/cliente.js";
import { igComentarios, waMensagens } from "../../db/schema.js";
import { instagramReal, lerContato } from "./cliente.js";
import { obterConversaInstagram, tocarConversa, gravarSaida } from "../whatsappConversas.js";

/**
 * Entrada do Instagram: avisos (webhook) de mensagens e comentários. Idempotente: o id externo (mid / id do comentário) é único,
 * então a Meta reenviar o mesmo aviso não duplica nada. LGPD: texto, nome e ids de pessoas nunca vão para log.
 */

type Obj = Record<string, any>;
const texto = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);
const idValido = (v: unknown): v is string => typeof v === "string" && /^[\w.-]{1,100}$/.test(v);

/** Quando (ms ou s desde 1970) vira data; fora do razoável → agora. */
function quandoDe(v: unknown, agora = new Date()): Date {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return agora;
  const d = new Date(n > 1e11 ? n : n * 1000); // A CONFIRMAR: a Meta manda milissegundos nas mensagens
  return d.getTime() > agora.getTime() + 3_600_000 ? agora : d;
}

const TIPOS_ANEXO: Record<string, { tipo: string; texto: string | null }> = {
  image: { tipo: "IMAGEM", texto: null }, audio: { tipo: "AUDIO", texto: null }, file: { tipo: "DOCUMENTO", texto: null },
  video: { tipo: "OUTRO", texto: "Vídeo" }, share: { tipo: "OUTRO", texto: "Publicação compartilhada" }, story_mention: { tipo: "OUTRO", texto: "Mencionou você em um story" },
  reel: { tipo: "OUTRO", texto: "Reel compartilhado" }, ig_reel: { tipo: "OUTRO", texto: "Reel compartilhado" },
};

/** O que mostrar de uma mensagem recebida. Sem texto nem anexo (ex.: reação, apagada) → null (ignorar). */
export function resumirMensagemInstagram(m: Obj): { tipo: string; texto: string | null } | null {
  if (m.is_deleted === true) return null;
  const t = texto(m.text, 4096);
  const anexo = Array.isArray(m.attachments) ? (m.attachments[0] as Obj | undefined) : undefined;
  if (anexo) {
    const base = TIPOS_ANEXO[String(anexo.type)] ?? { tipo: "OUTRO", texto: "Mensagem de um tipo que o sistema ainda não mostra" };
    return { tipo: base.tipo, texto: t ?? base.texto };
  }
  return t ? { tipo: "TEXTO", texto: t } : null;
}

async function receberMensagem(db: Db, config: Config, entryId: string | undefined, ev: Obj, buscar: typeof fetch): Promise<boolean> {
  const m = ev.message as Obj | undefined;
  if (!m || !idValido(m.mid)) return false;
  const eco = m.is_echo === true; // enviada por nós (pelo app do Instagram ou pela API)
  const contatoId = eco ? ev.recipient?.id : ev.sender?.id;
  const minhaConta = config.INSTAGRAM_CONTA_ID ?? entryId;
  if (!idValido(contatoId) || contatoId === minhaConta || contatoId === entryId) return false;
  const resumo = resumirMensagemInstagram(m);
  if (!resumo) return false;
  const quando = quandoDe(ev.timestamp);
  let conversa = await obterConversaInstagram(db, { idContato: contatoId });
  if (!conversa.nome && !eco && instagramReal(config)) {
    // Melhor esforço (A CONFIRMAR na doc): o nome vem de outra chamada; falhar não impede de guardar a mensagem.
    const r = await lerContato(config, contatoId, buscar);
    const nome = r.ok ? (r.dados?.name ?? r.dados?.username) : undefined;
    if (nome) conversa = await obterConversaInstagram(db, { idContato: contatoId, nome: nome.slice(0, 120) });
  }
  if (eco) {
    await gravarSaida(db, { conversaId: conversa.id, texto: resumo.texto ?? "", tipo: resumo.tipo, status: "ENVIADA", idExterno: m.mid, quando });
    return true;
  }
  const [nova] = await db.insert(waMensagens).values({
    conversaId: conversa.id, direcao: "ENTRADA", texto: resumo.texto, tipo: resumo.tipo, status: "RECEBIDA", idExterno: m.mid, criadoEm: quando,
  }).onConflictDoNothing().returning();
  if (nova) await tocarConversa(db, conversa.id, quando, true);
  return !!nova;
}

async function receberComentario(db: Db, config: Config, entryId: string | undefined, v: Obj, quando: Date): Promise<boolean> {
  if (!idValido(v.id)) return false;
  const autorId = idValido(v.from?.id) ? v.from.id : null;
  if (autorId && (autorId === config.INSTAGRAM_CONTA_ID || autorId === entryId)) return false; // comentário nosso
  const [novo] = await db.insert(igComentarios).values({
    idExterno: v.id, midiaId: idValido(v.media?.id) ? v.media.id : null, paiIdExterno: idValido(v.parent_id) ? v.parent_id : null,
    autorId, autorUsuario: texto(v.from?.username, 60), texto: texto(v.text, 2200), escritoEm: quando,
  }).onConflictDoNothing().returning({ id: igComentarios.id });
  return !!novo;
}

async function atualizarLida(db: Db, mid: unknown) {
  if (!idValido(mid)) return;
  await db.update(waMensagens).set({ status: "LIDA" }).where(and(eq(waMensagens.idExterno, mid), eq(waMensagens.direcao, "SAIDA"), sql`${waMensagens.status} = 'ENVIADA'`));
}

/**
 * Processa o corpo de um aviso da Meta (já com a assinatura conferida). Devolve só contagens (nunca texto).
 * Estrutura esperada (A CONFIRMAR na doc): { object:"instagram", entry:[{ id, messaging:[…] , changes:[{ field:"comments", value }] }] }.
 */
export async function processarAvisoInstagram(db: Db, config: Config, corpo: unknown, buscar: typeof fetch = fetch): Promise<{ mensagens: number; comentarios: number }> {
  const b = (corpo && typeof corpo === "object" ? corpo : {}) as Obj;
  const r = { mensagens: 0, comentarios: 0 };
  if (b.object !== "instagram" || !Array.isArray(b.entry)) return r;
  for (const entry of b.entry as Obj[]) {
    const entryId = typeof entry?.id === "string" ? entry.id : undefined;
    for (const ev of Array.isArray(entry?.messaging) ? (entry.messaging as Obj[]) : []) {
      try {
        if (ev.read) await atualizarLida(db, ev.read.mid);
        else if (await receberMensagem(db, config, entryId, ev, buscar)) r.mensagens++;
      } catch (e) {
        console.error("[instagram] falha ao processar mensagem:", e instanceof Error ? e.name : "erro");
      }
    }
    for (const ch of Array.isArray(entry?.changes) ? (entry.changes as Obj[]) : []) {
      try {
        if (ch.field === "comments" && ch.value && typeof ch.value === "object" && await receberComentario(db, config, entryId, ch.value, quandoDe(entry.time))) r.comentarios++;
      } catch (e) {
        console.error("[instagram] falha ao processar comentário:", e instanceof Error ? e.name : "erro");
      }
    }
  }
  return r;
}
