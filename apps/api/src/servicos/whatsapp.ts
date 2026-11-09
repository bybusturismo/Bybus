import type { UsoModelo } from "@bybus/core";
import type { Config } from "../config.js";

/**
 * Envio de WhatsApp. Dois modos:
 * - "simulado" (padrão): nada sai; a mensagem fica registrada como SIMULADA (seguro para testes e enquanto não há provedor).
 * - "evolution": Evolution API (WhatsApp Web, NÃO oficial — risco de bloqueio do número; mesma escolha do APP TOMA,
 *   que também permite postar em GRUPOS). Precisa de EVOLUTION_URL e EVOLUTION_API_KEY; instância em EVOLUTION_INSTANCIA.
 * Fora da produção o envio real só acontece com WHATSAPP_ENVIO_REAL=true (evita mandar mensagem a cliente de verdade em teste).
 */
export type ResultadoEnvio = { status: "ENVIADA" | "SIMULADA" | "FALHA"; provedor: string; erro?: string; /** Id da mensagem no WhatsApp (para deduplicar o aviso que a Evolution manda depois). */ idExterno?: string };

export function envioReal(c: Config): boolean {
  const liberado = c.AMBIENTE === "producao" || c.WHATSAPP_ENVIO_REAL;
  if (c.WHATSAPP_PROVEDOR === "meta") return liberado && !!c.META_WA_TOKEN && !!c.META_WA_NUMERO_ID;
  return c.WHATSAPP_PROVEDOR === "evolution" && !!c.EVOLUTION_URL && !!c.EVOLUTION_API_KEY && liberado;
}

/** O provedor manda para grupos? A Meta não (a lista vai à guia e ao motorista, um a um). */
export const enviaParaGrupo = (c: Config) => c.WHATSAPP_PROVEDOR !== "meta";

/** Telefone em dígitos com DDI (Brasil quando vier sem); grupo = JID "...@g.us". Inválido → null. */
export function normalizarDestino(destino: string | null | undefined): string | null {
  if (!destino) return null;
  const t = destino.trim();
  if (/^[\d-]+@g\.us$/.test(t)) return t;
  let d = t.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

/**
 * Chave para reconhecer o mesmo telefone escrito de jeitos diferentes: no Brasil, DDI+DDD+8 últimos dígitos
 * (ignora o 9 extra dos celulares); fora, os próprios dígitos. Entrada deve vir de normalizarDestino.
 */
export function chaveTelefone(normalizado: string): string {
  if (/^55\d{10,11}$/.test(normalizado)) return `55${normalizado.slice(2, 4)}${normalizado.slice(-8)}`;
  return normalizado;
}

/**
 * Opções do WhatsApp oficial: dentro da janela de 24 h (o cliente escreveu nas últimas 24 h) vale texto livre; fora dela,
 * só um modelo aprovado. Sem modelo fora da janela → FALHA "FORA_DA_JANELA" (a equipe responde quando o cliente escrever).
 */
export interface OpcoesEnvio { janelaAberta?: boolean; modelo?: UsoModelo | null }

async function enviarMeta(c: Config, destino: string, texto: string, o: OpcoesEnvio, buscar: typeof fetch): Promise<ResultadoEnvio> {
  if (destino.endsWith("@g.us")) return { status: "FALHA", provedor: "meta", erro: "GRUPO_NAO_SUPORTADO" };
  let corpo: Record<string, unknown>;
  if (o.janelaAberta) corpo = { type: "text", text: { body: texto.slice(0, 4096), preview_url: false } };
  else if (o.modelo) {
    corpo = { type: "template", template: { name: o.modelo.nome, language: { code: o.modelo.idioma },
      components: [{ type: "body", parameters: o.modelo.parametros.map((t) => ({ type: "text", text: t })) }] } };
  } else return { status: "FALHA", provedor: "meta", erro: "FORA_DA_JANELA" };
  try {
    const r = await buscar(`${c.META_GRAPH_URL.replace(/\/$/, "")}/${c.META_API_VERSAO}/${c.META_WA_NUMERO_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.META_WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: destino, ...corpo }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await r.json().catch(() => null)) as { messages?: Array<{ id?: unknown }>; error?: { code?: unknown } } | null;
    // Só o código do erro da Meta vai para o registro (nunca texto nem telefone).
    if (!r.ok) return { status: "FALHA", provedor: "meta", erro: `HTTP ${r.status}${json?.error?.code ? ` · ${String(json.error.code).slice(0, 12)}` : ""}` };
    const id = json?.messages?.[0]?.id;
    return { status: "ENVIADA", provedor: "meta", ...(typeof id === "string" ? { idExterno: id.slice(0, 200) } : {}) };
  } catch (e) {
    return { status: "FALHA", provedor: "meta", erro: e instanceof Error ? e.name : "erro" };
  }
}

export async function enviarWhatsapp(c: Config, destino: string, texto: string, buscar: typeof fetch = fetch, opcoes: OpcoesEnvio = {}): Promise<ResultadoEnvio> {
  if (!envioReal(c)) return { status: "SIMULADA", provedor: "simulado" };
  if (c.WHATSAPP_PROVEDOR === "meta") return enviarMeta(c, destino, texto, opcoes, buscar);
  const url = `${c.EVOLUTION_URL!.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(c.EVOLUTION_INSTANCIA)}`;
  try {
    const r = await buscar(url, {
      method: "POST",
      headers: { apikey: c.EVOLUTION_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ number: destino, text: texto.slice(0, 4096), linkPreview: false }),
      signal: AbortSignal.timeout(30_000),
    });
    // Nunca registrar o texto nem o telefone (LGPD): só o código do erro.
    if (!r.ok) return { status: "FALHA", provedor: "evolution", erro: `HTTP ${r.status}` };
    const corpo = (await r.json().catch(() => null)) as { key?: { id?: unknown } } | null;
    const idExterno = typeof corpo?.key?.id === "string" ? corpo.key.id : undefined;
    return { status: "ENVIADA", provedor: "evolution", ...(idExterno ? { idExterno } : {}) };
  } catch (e) {
    return { status: "FALHA", provedor: "evolution", erro: e instanceof Error ? e.name : "erro" };
  }
}
