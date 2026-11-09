import { createSign } from "node:crypto";
import type { Config } from "../config.js";

/**
 * Leitura de planilhas do Google pelo servidor, com uma CONTA DE SERVIÇO (pedido do dono, 09/11/2026): a planilha continua
 * privada; o dono compartilha só ela, como leitor, com o e-mail da conta de serviço. A chave da conta fica só no .env do servidor
 * (GOOGLE_CONTA_SERVICO, JSON em base64). Escopo só de leitura de planilhas. Nada é gravado no Google.
 */
interface Conta { client_email: string; private_key: string }

export function contaDeServico(c: Config): Conta | null {
  const bruto = c.GOOGLE_CONTA_SERVICO?.trim();
  if (!bruto) return null;
  try {
    const texto = bruto.startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8");
    const j = JSON.parse(texto) as Partial<Conta>;
    return j.client_email && j.private_key ? { client_email: j.client_email, private_key: j.private_key } : null;
  } catch {
    return null;
  }
}

/** ID da planilha a partir do link (docs.google.com/spreadsheets/d/<id>/…). */
export function idDaPlanilha(link: string): string | null {
  return /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(link)?.[1] ?? null;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
let cache: { email: string; token: string; ate: number } | null = null;

async function token(conta: Conta, buscar: typeof fetch): Promise<string> {
  if (cache && cache.email === conta.client_email && cache.ate > Date.now() + 60_000) return cache.token;
  const agora = Math.floor(Date.now() / 1000);
  const corpo = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: conta.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600,
  }))}`;
  const assinatura = createSign("RSA-SHA256").update(corpo).sign(conta.private_key);
  const r = await buscar("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${corpo}.${b64url(assinatura)}` }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!r.ok || !j?.access_token) throw new ErroGoogle("A chave da conta de serviço do Google não foi aceita. Confira a configuração no servidor.");
  cache = { email: conta.client_email, token: j.access_token, ate: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

export class ErroGoogle extends Error {}

async function getJson<T>(conta: Conta, url: string, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: { Authorization: `Bearer ${await token(conta, buscar)}` }, signal: AbortSignal.timeout(30_000) });
  if (r.status === 403 || r.status === 404) throw new ErroGoogle(`O sistema não tem acesso a esta planilha. No Google Sheets, clique em Compartilhar e adicione ${conta.client_email} como Leitor.`);
  if (!r.ok) throw new ErroGoogle(`O Google não respondeu (HTTP ${r.status}). Tente de novo em instantes.`);
  return (await r.json()) as T;
}

export async function abasDaPlanilha(conta: Conta, id: string, buscar: typeof fetch = fetch) {
  const j = await getJson<{ properties?: { title?: string }; sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }>(
    conta, `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties(sheetId,title)`, buscar);
  return { titulo: j.properties?.title ?? "Planilha", abas: (j.sheets ?? []).map((s) => ({ id: s.properties?.sheetId ?? 0, titulo: s.properties?.title ?? "" })).filter((a) => a.titulo) };
}

/** Uma aba em CSV, com os valores como aparecem na tela (o mesmo que "Fazer download › .csv"). */
export async function abaEmCsv(conta: Conta, id: string, titulo: string, buscar: typeof fetch = fetch): Promise<string> {
  const intervalo = encodeURIComponent(`'${titulo.replace(/'/g, "''")}'`);
  const j = await getJson<{ values?: unknown[][] }>(conta, `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${intervalo}?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, buscar);
  const cel = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return (j.values ?? []).map((linha) => linha.map(cel).join(",")).join("\n");
}

/** Só para os testes: esquece o token guardado. */
export function esquecerTokenGoogle() { cache = null; }
