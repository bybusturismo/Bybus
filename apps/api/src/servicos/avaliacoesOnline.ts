import { idLocalTripadvisor, notaDoGoogle, numeroDaApi, type CanalAvaliacaoOnline } from "@bybus/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { avaliacaoExternas, avaliacoesOnline, configuracoes, marketingConfig, unidades } from "../db/schema.js";
import type { Cofre } from "../seguranca/cripto.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { chaveLinkTripadvisor, hojeSp, segundaDaSemana } from "./marketingComum.js";

/**
 * Avaliações do Google e do Tripadvisor (dono, 18/11/2026).
 * - Google: API do perfil da empresa (Business Profile), com a conta Google dona do perfil conectada pela tela (OAuth; o token de
 *   renovação fica cifrado no banco). Lê todas as avaliações e permite responder. Endpoints v4 de avaliações (a confirmar na
 *   liberação do acesso; a documentação não abriu nesta sessão).
 * - Tripadvisor: API de conteúdo (chave no .env, restrita ao IP do servidor). Devolve nota, total e até 5 avaliações recentes por
 *   idioma; a tela mostra o selo e o link do Tripadvisor (atribuição exigida). Endereços a confirmar ao criar a chave.
 * A leitura roda uma vez por dia (rotinas do marketing) e pelo botão "Atualizar agora". Atualiza também a nota semanal da praça
 * (as "notas nos canais" que antes eram lançadas à mão).
 */

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_ESCOPO = "https://www.googleapis.com/auth/business.manage";
const GBP_CONTAS = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const GBP_INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const GBP_V4 = "https://mybusiness.googleapis.com/v4";
const TA_BASE = "https://api.content.tripadvisor.com/api/v1";
const TA_IDIOMAS = ["pt", "en", "es"] as const;

const CHAVE_TOKEN = "avaliacoes.google_token";
const CHAVE_LOCAIS = "avaliacoes.locais";
const CHAVE_SINCRONIA = "avaliacoes.sincronia";

let buscar: typeof fetch = (...a) => fetch(...a);
/** Só para testes: troca o fetch (nenhum teste chama o Google ou o Tripadvisor de verdade). */
export function definirBuscaAvaliacoes(f: typeof fetch | null) { buscar = f ?? ((...a) => fetch(...a)); }

export const googleConfigurado = (c: Config) => !!c.GOOGLE_PERFIL_CLIENT_ID && !!c.GOOGLE_PERFIL_CLIENT_SECRET;
export const tripadvisorConfigurado = (c: Config) => !!c.TRIPADVISOR_API_KEY;
export const urlRetornoGoogle = (c: Config) => (c.URL_PUBLICA ? `${c.URL_PUBLICA.replace(/\/$/, "")}/api/marketing/google/retorno` : null);

async function lerConfig(db: Db, chave: string) {
  const [l] = await db.select({ valor: configuracoes.valor }).from(configuracoes).where(eq(configuracoes.chave, chave));
  return l?.valor ?? null;
}
async function gravarConfig(db: Db, chave: string, valor: string | null, usuarioId?: string | null) {
  if (valor === null) { await db.delete(configuracoes).where(eq(configuracoes.chave, chave)); return; }
  await db.insert(configuracoes).values({ chave, valor, atualizadoPor: usuarioId ?? null })
    .onConflictDoUpdate({ target: configuracoes.chave, set: { valor, atualizadoPor: usuarioId ?? null, atualizadoEm: new Date() } });
}

// ------------------------------------------------------------------ locais por praça

const zLocais = z.record(z.string().uuid(), z.object({ google: z.string().regex(/^accounts\/[^/]+\/locations\/[^/]+$/).nullish(), tripadvisor: z.string().regex(/^\d{3,12}$/).nullish() }));
export type LocaisAvaliacao = Record<string, { google: string | null; tripadvisor: string | null; nome: string; codigo: string }>;

/** Local do Google (escolhido na tela) e do Tripadvisor (escolhido ou tirado do link cadastrado no Marketing) por praça. */
export async function locaisPorPraca(db: Db): Promise<LocaisAvaliacao> {
  let salvo: z.infer<typeof zLocais> = {};
  try { const v = await lerConfig(db, CHAVE_LOCAIS); salvo = v ? zLocais.parse(JSON.parse(v)) : {}; } catch { salvo = {}; }
  const pracas = await db.select({ id: unidades.id, codigo: unidades.codigo, nome: unidades.nome }).from(unidades).where(eq(unidades.ativa, true));
  const links = pracas.length ? await db.select().from(marketingConfig).where(inArray(marketingConfig.chave, pracas.map((p) => chaveLinkTripadvisor(p.id)))) : [];
  return Object.fromEntries(pracas.map((p) => {
    const link = links.find((l) => l.chave === chaveLinkTripadvisor(p.id))?.valor ?? null;
    return [p.id, { google: salvo[p.id]?.google ?? null, tripadvisor: salvo[p.id]?.tripadvisor ?? idLocalTripadvisor(link), nome: p.nome, codigo: p.codigo }];
  }));
}
export async function salvarLocais(db: Db, v: Record<string, { google?: string | null; tripadvisor?: string | null }>, usuarioId: string) {
  await gravarConfig(db, CHAVE_LOCAIS, JSON.stringify(zLocais.parse(v)), usuarioId);
}

// ------------------------------------------------------------------ Google: conexão (OAuth)

const estados = new Map<string, { usuarioId: string; expira: number }>();
/** Endereço do Google para a pessoa autorizar (conta dona do perfil). O `state` amarra a volta a quem pediu (10 min). */
export function urlConectarGoogle(c: Config, usuarioId: string): string {
  const retorno = urlRetornoGoogle(c);
  if (!googleConfigurado(c) || !retorno) throw new ErroHttp(400, "GOOGLE_NAO_CONFIGURADO", "O Google ainda não foi ligado no servidor (falta o cliente OAuth ou o endereço público).");
  for (const [k, v] of estados) if (v.expira < Date.now()) estados.delete(k);
  const state = randomBytes(24).toString("hex");
  estados.set(state, { usuarioId, expira: Date.now() + 10 * 60_000 });
  const q = new URLSearchParams({ client_id: c.GOOGLE_PERFIL_CLIENT_ID!, redirect_uri: retorno, response_type: "code", scope: GOOGLE_ESCOPO, access_type: "offline", prompt: "consent", state });
  return `${GOOGLE_AUTH}?${q}`;
}

/** Volta do Google: confere o `state`, troca o código pelo token de renovação e guarda cifrado. */
export async function concluirConexaoGoogle(db: Db, c: Config, cofre: Cofre, usuarioId: string, codigo: string, state: string) {
  const e = estados.get(state);
  estados.delete(state);
  if (!e || e.expira < Date.now() || e.usuarioId !== usuarioId) throw new ErroHttp(400, "GOOGLE_ESTADO_INVALIDO", "A autorização expirou ou não foi pedida por você. Clique em Conectar de novo.");
  const r = await buscar(GOOGLE_TOKEN, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: codigo, client_id: c.GOOGLE_PERFIL_CLIENT_ID!, client_secret: c.GOOGLE_PERFIL_CLIENT_SECRET!, redirect_uri: urlRetornoGoogle(c)!, grant_type: "authorization_code" }),
  });
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string };
  if (!r.ok || !j.refresh_token) throw new ErroHttp(502, "GOOGLE_RECUSOU", "O Google não devolveu a autorização. Tente de novo (use a conta Google dona do perfil da empresa).");
  await gravarConfig(db, CHAVE_TOKEN, cofre.cifrar(j.refresh_token), usuarioId);
}
export async function desconectarGoogle(db: Db) { await gravarConfig(db, CHAVE_TOKEN, null); }
export async function googleConectado(db: Db) { return !!(await lerConfig(db, CHAVE_TOKEN)); }

async function tokenGoogle(db: Db, c: Config, cofre: Cofre): Promise<string> {
  const cifrado = await lerConfig(db, CHAVE_TOKEN);
  if (!cifrado || !googleConfigurado(c)) throw new ErroHttp(400, "GOOGLE_DESCONECTADO", "Conecte a conta Google do perfil da empresa.");
  const r = await buscar(GOOGLE_TOKEN, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: cofre.decifrar(cifrado), client_id: c.GOOGLE_PERFIL_CLIENT_ID!, client_secret: c.GOOGLE_PERFIL_CLIENT_SECRET!, grant_type: "refresh_token" }),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!r.ok || !j.access_token) throw new ErroHttp(502, "GOOGLE_TOKEN", j.error === "invalid_grant" ? "A conexão com o Google expirou ou foi retirada. Conecte de novo." : "O Google recusou o acesso agora. Tente mais tarde.");
  return j.access_token;
}
async function getGoogle(token: string, url: string) {
  const r = await buscar(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new ErroHttp(502, "GOOGLE_ERRO", `O Google respondeu ${r.status}${j?.error?.status ? ` (${String(j.error.status).slice(0, 40)})` : ""}.`);
  return j;
}

/** Perfis da empresa (locais) que a conta conectada administra, para escolher o de cada praça. */
export async function listarLocaisGoogle(db: Db, c: Config, cofre: Cofre) {
  const token = await tokenGoogle(db, c, cofre);
  const contas = ((await getGoogle(token, GBP_CONTAS)).accounts ?? []) as Array<{ name: string; accountName?: string }>;
  const locais: Array<{ nome: string; titulo: string; conta: string }> = [];
  for (const conta of contas.slice(0, 10)) {
    const j = await getGoogle(token, `${GBP_INFO}/${conta.name}/locations?readMask=name,title&pageSize=100`);
    for (const l of (j.locations ?? []) as Array<{ name: string; title?: string }>) {
      // a API de informações devolve "locations/123"; a de avaliações (v4) usa "accounts/1/locations/123"
      locais.push({ nome: `${conta.name}/${l.name}`, titulo: l.title ?? l.name, conta: conta.accountName ?? conta.name });
    }
  }
  return locais;
}

// ------------------------------------------------------------------ leitura

interface Lida { idExterno: string; referencia: string | null; autor: string | null; nota: number; titulo: string | null; texto: string | null; idioma: string | null; publicadaEm: Date | null; url: string | null; resposta: string | null; respondidaEm: Date | null }

async function gravarAvaliacoes(db: Db, canal: CanalAvaliacaoOnline, unidadeId: string, lidas: Lida[]): Promise<number> {
  let novas = 0;
  for (const a of lidas) {
    const [r] = await db.insert(avaliacoesOnline).values({ canal, unidadeId, ...a }).onConflictDoUpdate({
      target: [avaliacoesOnline.canal, avaliacoesOnline.idExterno],
      set: { nota: a.nota, titulo: a.titulo, texto: a.texto, resposta: a.resposta, respondidaEm: a.respondidaEm, referencia: a.referencia, url: a.url, atualizadoEm: new Date() },
    }).returning({ inserida: sql<boolean>`(xmax = 0)` }); // xmax = 0: a linha acabou de ser inserida (não atualizada)
    if (r?.inserida) novas++;
  }
  return novas;
}

/** Nota e total da praça na semana (substitui o lançamento manual nas "notas nos canais"). */
async function gravarNotaSemanal(db: Db, canal: CanalAvaliacaoOnline, unidadeId: string, media: number | null, total: number | null) {
  if (media == null || total == null) return;
  const semana = segundaDaSemana(hojeSp());
  const valores = { notaCentesimos: Math.round(media * 100), quantidade: Math.round(total) };
  const [ja] = await db.select({ id: avaliacaoExternas.id }).from(avaliacaoExternas)
    .where(and(eq(avaliacaoExternas.semana, semana), eq(avaliacaoExternas.canal, canal), eq(avaliacaoExternas.alvo, "PROPRIA"), eq(avaliacaoExternas.unidadeId, unidadeId)));
  if (ja) await db.update(avaliacaoExternas).set(valores).where(eq(avaliacaoExternas.id, ja.id));
  else await db.insert(avaliacaoExternas).values({ semana, canal, alvo: "PROPRIA", unidadeId, ...valores });
}

const textoOuNulo = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const dataOuNula = (v: unknown) => { const d = typeof v === "string" ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

/** Google: todas as avaliações do local (até 1.000, em páginas de 50). */
async function lerGoogle(db: Db, c: Config, cofre: Cofre, unidadeId: string, local: string) {
  const token = await tokenGoogle(db, c, cofre);
  const lidas: Lida[] = [];
  let pagina: string | undefined;
  let media: number | null = null, total: number | null = null;
  for (let i = 0; i < 20; i++) {
    const j = await getGoogle(token, `${GBP_V4}/${local}/reviews?pageSize=50${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`);
    media ??= numeroDaApi(j.averageRating);
    total ??= numeroDaApi(j.totalReviewCount);
    for (const r of (j.reviews ?? []) as Array<Record<string, any>>) {
      const nota = notaDoGoogle(r.starRating);
      if (!nota || typeof r.reviewId !== "string") continue;
      lidas.push({
        idExterno: r.reviewId.slice(0, 200), referencia: typeof r.name === "string" ? r.name.slice(0, 400) : `${local}/reviews/${r.reviewId}`,
        autor: r.reviewer?.isAnonymous ? null : textoOuNulo(r.reviewer?.displayName, 120), nota, titulo: null,
        // o Google junta a tradução automática ao texto original: guarda só o original
        texto: textoOuNulo(typeof r.comment === "string" ? r.comment.split("\n\n(Translated by Google)")[0]!.replace(/^\(Original\)\n/, "") : null, 5000),
        idioma: null, publicadaEm: dataOuNula(r.createTime), url: null,
        resposta: textoOuNulo(r.reviewReply?.comment, 4000), respondidaEm: dataOuNula(r.reviewReply?.updateTime),
      });
    }
    pagina = typeof j.nextPageToken === "string" && j.nextPageToken ? j.nextPageToken : undefined;
    if (!pagina) break;
  }
  const novas = await gravarAvaliacoes(db, "GOOGLE", unidadeId, lidas);
  await gravarNotaSemanal(db, "GOOGLE", unidadeId, media, total);
  return { lidas: lidas.length, novas, media, total };
}

/** Tripadvisor: nota e total do local e as avaliações recentes em português, inglês e espanhol (até 5 por idioma). */
async function lerTripadvisor(db: Db, c: Config, unidadeId: string, local: string) {
  const get = async (caminho: string, idioma?: string) => {
    const q = new URLSearchParams({ key: c.TRIPADVISOR_API_KEY!, ...(idioma ? { language: idioma } : {}) });
    const r = await buscar(`${TA_BASE}/location/${encodeURIComponent(local)}/${caminho}?${q}`, { headers: { accept: "application/json" } });
    const j = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (!r.ok) throw new ErroHttp(502, "TRIPADVISOR_ERRO", `O Tripadvisor respondeu ${r.status}${j?.error?.message ? ` (${String(j.error.message).slice(0, 80)})` : ""}.`);
    return j;
  };
  const det = await get("details", "pt");
  const lidas: Lida[] = [];
  for (const idioma of TA_IDIOMAS) {
    const j = await get("reviews", idioma);
    for (const r of (j.data ?? []) as Array<Record<string, any>>) {
      const nota = numeroDaApi(r.rating);
      if (!nota || r.id == null) continue;
      lidas.push({
        idExterno: String(r.id).slice(0, 200), referencia: null, autor: textoOuNulo(r.user?.username, 120), nota: Math.round(nota),
        titulo: textoOuNulo(r.title, 300), texto: textoOuNulo(r.text, 5000), idioma: textoOuNulo(r.lang, 10) ?? idioma,
        publicadaEm: dataOuNula(r.published_date), url: textoOuNulo(r.url, 500),
        resposta: textoOuNulo(r.owner_response?.text, 4000), respondidaEm: dataOuNula(r.owner_response?.published_date),
      });
    }
  }
  const novas = await gravarAvaliacoes(db, "TRIPADVISOR", unidadeId, lidas);
  const media = numeroDaApi(det.rating), total = numeroDaApi(det.num_reviews);
  await gravarNotaSemanal(db, "TRIPADVISOR", unidadeId, media, total);
  return { lidas: lidas.length, novas, media, total, link: textoOuNulo(det.web_url, 500), selo: textoOuNulo(det.rating_image_url, 500) };
}

export interface Sincronia { data: string; em: string; resultados: Array<{ canal: CanalAvaliacaoOnline; unidadeId: string; ok: boolean; novas?: number; media?: number | null; total?: number | null; link?: string | null; selo?: string | null; erro?: string }> }

/** Lê o que estiver ligado (Google conectado e com local; Tripadvisor com chave e local) em todas as praças. Erro de um não para o outro. */
export async function sincronizarAvaliacoes(db: Db, c: Config, cofre: Cofre): Promise<Sincronia> {
  const locais = await locaisPorPraca(db);
  const conectado = googleConfigurado(c) && (await googleConectado(db));
  const resultados: Sincronia["resultados"] = [];
  for (const [unidadeId, l] of Object.entries(locais)) {
    if (conectado && l.google) {
      try { resultados.push({ canal: "GOOGLE", unidadeId, ok: true, ...(await lerGoogle(db, c, cofre, unidadeId, l.google)) }); }
      catch (e) { resultados.push({ canal: "GOOGLE", unidadeId, ok: false, erro: e instanceof Error ? e.message.slice(0, 200) : "erro" }); }
    }
    if (tripadvisorConfigurado(c) && l.tripadvisor) {
      try { resultados.push({ canal: "TRIPADVISOR", unidadeId, ok: true, ...(await lerTripadvisor(db, c, unidadeId, l.tripadvisor)) }); }
      catch (e) { resultados.push({ canal: "TRIPADVISOR", unidadeId, ok: false, erro: e instanceof Error ? e.message.slice(0, 200) : "erro" }); }
    }
  }
  const s: Sincronia = { data: hojeSp(), em: new Date().toISOString(), resultados };
  await gravarConfig(db, CHAVE_SINCRONIA, JSON.stringify(s));
  return s;
}
export async function ultimaSincronia(db: Db): Promise<Sincronia | null> {
  try { const v = await lerConfig(db, CHAVE_SINCRONIA); return v ? (JSON.parse(v) as Sincronia) : null; } catch { return null; }
}
/** Rotina diária (a partir das 7h, uma vez por dia, só se algo estiver ligado). */
export async function sincronizarSeDevido(db: Db, c: Config, cofre: Cofre, hora: string): Promise<Sincronia | null> {
  if (!googleConfigurado(c) && !tripadvisorConfigurado(c)) return null;
  if (hora < "07:00") return null;
  if ((await ultimaSincronia(db))?.data === hojeSp()) return null;
  return sincronizarAvaliacoes(db, c, cofre);
}

/** Responde (ou troca a resposta de) uma avaliação do Google pelo sistema. */
export async function responderGoogle(db: Db, c: Config, cofre: Cofre, id: string, texto: string) {
  const [a] = await db.select().from(avaliacoesOnline).where(eq(avaliacoesOnline.id, id));
  if (!a) throw new ErroHttp(404, "NAO_ENCONTRADO", "Avaliação não encontrada.");
  if (a.canal !== "GOOGLE" || !a.referencia) throw new ErroHttp(400, "SO_GOOGLE", "Pelo sistema só dá para responder as avaliações do Google. No Tripadvisor, responda pelo painel do Tripadvisor.");
  const token = await tokenGoogle(db, c, cofre);
  const r = await buscar(`${GBP_V4}/${a.referencia}/reply`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ comment: texto }) });
  if (!r.ok) throw new ErroHttp(502, "GOOGLE_ERRO", `O Google não aceitou a resposta agora (${r.status}). Tente de novo.`);
  const [x] = await db.update(avaliacoesOnline).set({ resposta: texto, respondidaEm: new Date(), lida: true, atualizadoEm: new Date() }).where(eq(avaliacoesOnline.id, id)).returning();
  return x!;
}
