import type { Config } from "../config.js";

/**
 * Envio de WhatsApp. Dois modos:
 * - "simulado" (padrão): nada sai; a mensagem fica registrada como SIMULADA (seguro para testes e enquanto não há provedor).
 * - "evolution": Evolution API (WhatsApp Web, NÃO oficial — risco de bloqueio do número; mesma escolha do APP TOMA,
 *   que também permite postar em GRUPOS). Precisa de EVOLUTION_URL e EVOLUTION_API_KEY; instância em EVOLUTION_INSTANCIA.
 * Fora da produção o envio real só acontece com WHATSAPP_ENVIO_REAL=true (evita mandar mensagem a cliente de verdade em teste).
 */
export type ResultadoEnvio = { status: "ENVIADA" | "SIMULADA" | "FALHA"; provedor: string; erro?: string };

export function envioReal(c: Config): boolean {
  return c.WHATSAPP_PROVEDOR === "evolution" && !!c.EVOLUTION_URL && !!c.EVOLUTION_API_KEY && (c.AMBIENTE === "producao" || c.WHATSAPP_ENVIO_REAL);
}

/** Telefone em dígitos com DDI (Brasil quando vier sem); grupo = JID "...@g.us". Inválido → null. */
export function normalizarDestino(destino: string | null | undefined): string | null {
  if (!destino) return null;
  const t = destino.trim();
  if (/^[\d-]+@g\.us$/.test(t)) return t;
  let d = t.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

export async function enviarWhatsapp(c: Config, destino: string, texto: string, buscar: typeof fetch = fetch): Promise<ResultadoEnvio> {
  if (!envioReal(c)) return { status: "SIMULADA", provedor: "simulado" };
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
    return { status: "ENVIADA", provedor: "evolution" };
  } catch (e) {
    return { status: "FALHA", provedor: "evolution", erro: e instanceof Error ? e.name : "erro" };
  }
}
