import { createSign } from "node:crypto";
import type { Config } from "../config.js";

/**
 * Leitura de planilhas do Google pelo servidor, com uma CONTA DE SERVIÇO (pedido do dono, 09/11/2026): a planilha continua
 * privada; o dono compartilha só ela, como leitor, com o e-mail da conta de serviço. A chave da conta fica só no .env do servidor
 * (GOOGLE_CONTA_SERVICO, JSON em base64). Escopos só de leitura (planilhas e Drive, este para os arquivos da frota). Nada é gravado no Google.
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
    iss: conta.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600,
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

// ---------------------------------------------------------------- Drive (arquivos da frota: gabaritos etc., 11/11/2026)

/** ID de um arquivo ou pasta do Drive a partir do link (…/folders/<id>, …/file/d/<id>, …?id=<id>) ou do próprio ID. */
export function idDoDrive(link: string): string | null {
  const t = link.trim();
  const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(t) ?? /\/d\/([A-Za-z0-9_-]{10,})/.exec(t) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(t);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null;
}

export const PASTA_DRIVE = "application/vnd.google-apps.folder";
export interface ItemDrive { id: string; nome: string; tipo: string; tamanho: number | null; modificadoEm: string | null; caminho: string }

const CAMPOS = "id,name,mimeType,size,modifiedTime";
interface ArquivoApi { id?: string; name?: string; mimeType?: string; size?: string; modifiedTime?: string }
const paraItem = (f: ArquivoApi, caminho: string): ItemDrive => ({ id: f.id ?? "", nome: f.name ?? "", tipo: f.mimeType ?? "", tamanho: f.size ? Number(f.size) : null, modificadoEm: f.modifiedTime ?? null, caminho });

async function getDrive<T>(conta: Conta, url: string, buscar: typeof fetch): Promise<T> {
  const r = await buscar(url, { headers: { Authorization: `Bearer ${await token(conta, buscar)}` }, signal: AbortSignal.timeout(30_000) });
  if (r.status === 403 || r.status === 404) throw new ErroGoogle(`O sistema não tem acesso a esta pasta. No Drive, clique em Compartilhar e adicione ${conta.client_email} como Leitor.`);
  if (!r.ok) throw new ErroGoogle(`O Google não respondeu (HTTP ${r.status}). Tente de novo em instantes.`);
  return (await r.json()) as T;
}

/**
 * Arquivos de uma pasta do Drive (com as subpastas, até 3 níveis e 500 arquivos) ou o próprio arquivo, se o link for de um arquivo.
 * `caminho` = subpastas até o arquivo ("" na raiz).
 */
export async function arquivosDoDrive(conta: Conta, id: string, buscar: typeof fetch = fetch): Promise<{ nome: string; itens: ItemDrive[] }> {
  const raiz = await getDrive<ArquivoApi>(conta, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${CAMPOS}&supportsAllDrives=true`, buscar);
  if (raiz.mimeType !== PASTA_DRIVE) return { nome: raiz.name ?? "", itens: [paraItem(raiz, "")] };
  const itens: ItemDrive[] = [];
  const fila: Array<{ id: string; caminho: string; nivel: number }> = [{ id, caminho: "", nivel: 0 }];
  while (fila.length && itens.length < 500) {
    const p = fila.shift()!;
    let pagina: string | undefined;
    do {
      const q = encodeURIComponent(`'${p.id}' in parents and trashed = false`);
      const j = await getDrive<{ files?: ArquivoApi[]; nextPageToken?: string }>(conta,
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(${CAMPOS})&pageSize=200&orderBy=folder,name&supportsAllDrives=true&includeItemsFromAllDrives=true${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`, buscar);
      for (const f of j.files ?? []) {
        if (f.mimeType === PASTA_DRIVE) { if (p.nivel < 3 && f.id) fila.push({ id: f.id, caminho: p.caminho ? `${p.caminho} / ${f.name}` : f.name ?? "", nivel: p.nivel + 1 }); }
        else if (itens.length < 500) itens.push(paraItem(f, p.caminho));
      }
      pagina = j.nextPageToken;
    } while (pagina && itens.length < 500);
  }
  return { nome: raiz.name ?? "", itens };
}

/** Conteúdo de um arquivo do Drive. Documentos do Google (Docs, Planilhas, Apresentações, Desenhos) saem em PDF. */
export async function baixarDoDrive(conta: Conta, item: ItemDrive, buscar: typeof fetch = fetch): Promise<{ tipo: string; nome: string; dados: Buffer }> {
  const google = item.tipo.startsWith("application/vnd.google-apps.");
  const url = google
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}/export?mimeType=${encodeURIComponent("application/pdf")}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?alt=media&supportsAllDrives=true`;
  const r = await buscar(url, { headers: { Authorization: `Bearer ${await token(conta, buscar)}` }, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new ErroGoogle(`Não consegui baixar o arquivo do Drive (HTTP ${r.status}).`);
  const dados = Buffer.from(await r.arrayBuffer());
  return { tipo: google ? "application/pdf" : item.tipo || "application/octet-stream", nome: google ? `${item.nome}.pdf` : item.nome, dados };
}
