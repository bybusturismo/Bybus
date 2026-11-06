import type { Config } from "../../config.js";

/**
 * Cliente da Graph API do Instagram ("Instagram API com Instagram Login", da Meta).
 * ISOLADO neste arquivo: todo endereço, campo e nome de métrica da Meta mora aqui. Nada foi testado contra a Meta
 * (ainda não há token): tudo marcado "A CONFIRMAR" deve ser conferido na documentação oficial no dia da conexão —
 * https://developers.facebook.com/docs/instagram-platform (Instagram API with Instagram Login).
 *
 * Regras de segurança:
 * - o token vai no cabeçalho Authorization (nunca na URL, para não cair em log);
 * - nenhum texto de cliente, nome ou corpo de resposta é registrado: erros viram só o código da Meta;
 * - fora da produção, só fala com a Meta com INSTAGRAM_ENVIO_REAL=true (ver `instagramReal`).
 */

export interface EstadoInstagram {
  /** Tem token e id da conta. */
  conectado: boolean;
  /** Fala de verdade com a Meta (conectado + produção ou INSTAGRAM_ENVIO_REAL=true). */
  real: boolean;
  simulado: boolean;
  /** Webhook configurado (segredo do app + token de verificação). */
  avisosLigados: boolean;
}

export const instagramConectado = (c: Config): boolean => !!c.INSTAGRAM_TOKEN && !!c.INSTAGRAM_CONTA_ID;
export const instagramReal = (c: Config): boolean => instagramConectado(c) && (c.AMBIENTE === "producao" || c.INSTAGRAM_ENVIO_REAL);
export function estadoInstagram(c: Config): EstadoInstagram {
  const real = instagramReal(c);
  return { conectado: instagramConectado(c), real, simulado: !real, avisosLigados: !!c.INSTAGRAM_APP_SECRET && !!c.INSTAGRAM_WEBHOOK_VERIFY_TOKEN };
}

/** Resposta padronizada: `status` nulo = falha de rede/tempo esgotado; `codigo` = error.code da Meta (nunca a mensagem, que pode citar dados). */
export interface RespostaGraph<T> { ok: boolean; status: number | null; dados?: T; codigo?: string }

type Query = Record<string, string | number | boolean | undefined>;

async function chamar<T>(c: Config, metodo: "GET" | "POST", caminho: string, opcoes: { query?: Query; corpo?: unknown } = {}, buscar: typeof fetch = fetch): Promise<RespostaGraph<T>> {
  const url = new URL(`${c.INSTAGRAM_GRAPH_URL.replace(/\/$/, "")}/${c.INSTAGRAM_API_VERSAO}${caminho}`);
  for (const [k, v] of Object.entries(opcoes.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  try {
    const r = await buscar(url, {
      method: metodo,
      headers: { Authorization: `Bearer ${c.INSTAGRAM_TOKEN}`, ...(opcoes.corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(opcoes.corpo !== undefined ? { body: JSON.stringify(opcoes.corpo) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await r.json().catch(() => null)) as (T & { error?: { code?: unknown } }) | null;
    if (!r.ok) return { ok: false, status: r.status, codigo: json?.error?.code !== undefined ? String(json.error.code).slice(0, 20) : `HTTP_${r.status}` };
    return { ok: true, status: r.status, dados: json as T };
  } catch (e) {
    return { ok: false, status: null, codigo: e instanceof Error ? e.name : "ERRO" };
  }
}

const conta = (c: Config) => c.INSTAGRAM_CONTA_ID!;

// ---------------------------------------------------------------- Dados da conta (Marketing)

/** GET /{conta}?fields=… — seguidores e quantidade de posts. A CONFIRMAR: nomes dos campos. */
export const lerPerfil = (c: Config, buscar?: typeof fetch) =>
  chamar<{ followers_count?: number; media_count?: number; username?: string }>(c, "GET", `/${conta(c)}`, { query: { fields: "followers_count,media_count,username" } }, buscar);

/**
 * GET /{conta}/insights — um dia de cada vez (since/until em segundos), métricas "do dia" com metric_type=total_value.
 * A CONFIRMAR: nomes atuais das métricas (reach, views — que substituiu impressions —, profile_views, website_clicks)
 * e se `since`/`until` aceitam esse formato.
 */
export const METRICAS_CONTA = ["reach", "views", "profile_views", "website_clicks"] as const;
export const lerInsightsConta = (c: Config, desdeSeg: number, ateSeg: number, buscar?: typeof fetch) =>
  chamar<{ data?: Array<{ name?: string; total_value?: { value?: number }; values?: Array<{ value?: number }> }> }>(
    c, "GET", `/${conta(c)}/insights`, { query: { metric: METRICAS_CONTA.join(","), period: "day", metric_type: "total_value", since: desdeSeg, until: ateSeg } }, buscar);

export interface MidiaInstagram {
  id: string; media_type?: string; media_product_type?: string; caption?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number;
}
/** GET /{conta}/media — posts mais recentes. A CONFIRMAR: campos e paginação (paging.next). */
export const listarMidias = (c: Config, limite = 50, buscar?: typeof fetch) =>
  chamar<{ data?: MidiaInstagram[] }>(c, "GET", `/${conta(c)}/media`, { query: { fields: "id,media_type,media_product_type,caption,permalink,timestamp,like_count,comments_count", limit: limite } }, buscar);

/** GET /{midia}/insights. A CONFIRMAR: métricas por tipo de mídia (reach, saved, shares, views); tipo errado devolve erro e fica sem número. */
export const lerInsightsMidia = (c: Config, midiaId: string, buscar?: typeof fetch) =>
  chamar<{ data?: Array<{ name?: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }> }>(
    c, "GET", `/${encodeURIComponent(midiaId)}/insights`, { query: { metric: "reach,saved,shares,views" } }, buscar);

/** GET /{conta}/content_publishing_limit — uso da cota de publicações. A CONFIRMAR: campos e o limite diário (hoje citado como 100 em 24 h). */
export const lerLimitePublicacao = (c: Config, buscar?: typeof fetch) =>
  chamar<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(c, "GET", `/${conta(c)}/content_publishing_limit`, { query: { fields: "quota_usage,config" } }, buscar);

// ---------------------------------------------------------------- Direct

/** POST /{conta}/messages com {recipient:{id}, message:{text}}. A CONFIRMAR: caminho (/{conta}/messages ou /me/messages) e a janela de 24 h. */
export const enviarDirect = (c: Config, destinatarioId: string, texto: string, buscar?: typeof fetch) =>
  chamar<{ recipient_id?: string; message_id?: string }>(c, "POST", `/${conta(c)}/messages`, { corpo: { recipient: { id: destinatarioId }, message: { text: texto.slice(0, 1000) } } }, buscar);

/** GET /{igsid}?fields=name,username — nome do contato (melhor esforço). A CONFIRMAR: campos disponíveis. */
export const lerContato = (c: Config, igsid: string, buscar?: typeof fetch) =>
  chamar<{ name?: string; username?: string }>(c, "GET", `/${encodeURIComponent(igsid)}`, { query: { fields: "name,username" } }, buscar);

// ---------------------------------------------------------------- Comentários

/** POST /{comentario}/replies com message. Só comentários de primeiro nível (a CONFIRMAR). */
export const responderComentario = (c: Config, comentarioId: string, texto: string, buscar?: typeof fetch) =>
  chamar<{ id?: string }>(c, "POST", `/${encodeURIComponent(comentarioId)}/replies`, { corpo: { message: texto.slice(0, 2200) } }, buscar);

/** POST /{comentario} com hide=true|false. A CONFIRMAR. */
export const ocultarComentario = (c: Config, comentarioId: string, ocultar: boolean, buscar?: typeof fetch) =>
  chamar<{ success?: boolean }>(c, "POST", `/${encodeURIComponent(comentarioId)}`, { corpo: { hide: ocultar } }, buscar);

// ---------------------------------------------------------------- Publicação (criar contêiner → publicar)

export interface ParamsContainer {
  /** A Meta busca o arquivo nesta URL pública (https). */
  url: string;
  ehVideo: boolean;
  legenda?: string | null;
  /** Item de carrossel (sem legenda). */
  itemCarrossel?: boolean;
  /** Pai do carrossel: ids dos filhos. */
  filhos?: string[];
  tipo: "IMAGEM" | "CARROSSEL" | "REELS" | "STORY";
}

/**
 * POST /{conta}/media. Imagem: image_url + caption. Vídeo/Reels: media_type=REELS + video_url. Story: media_type=STORIES (A CONFIRMAR).
 * Carrossel: filhos com is_carousel_item=true; pai com media_type=CAROUSEL + children (ids separados por vírgula).
 */
export function criarContainer(c: Config, p: ParamsContainer, buscar?: typeof fetch) {
  const corpo: Record<string, unknown> = {};
  if (p.filhos) {
    corpo.media_type = "CAROUSEL";
    corpo.children = p.filhos.join(",");
  } else if (p.itemCarrossel) {
    corpo.is_carousel_item = true;
    corpo[p.ehVideo ? "video_url" : "image_url"] = p.url;
    if (p.ehVideo) corpo.media_type = "VIDEO";
  } else if (p.tipo === "STORY") {
    corpo.media_type = "STORIES";
    corpo[p.ehVideo ? "video_url" : "image_url"] = p.url;
  } else if (p.ehVideo) {
    corpo.media_type = "REELS";
    corpo.video_url = p.url;
  } else {
    corpo.image_url = p.url;
  }
  if (p.legenda && !p.itemCarrossel && p.tipo !== "STORY") corpo.caption = p.legenda;
  return chamar<{ id?: string }>(c, "POST", `/${conta(c)}/media`, { corpo }, buscar);
}

/** GET /{contêiner}?fields=status_code — IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED. A CONFIRMAR. */
export const statusContainer = (c: Config, id: string, buscar?: typeof fetch) =>
  chamar<{ status_code?: string }>(c, "GET", `/${encodeURIComponent(id)}`, { query: { fields: "status_code" } }, buscar);

/** POST /{conta}/media_publish com creation_id. */
export const publicarContainer = (c: Config, id: string, buscar?: typeof fetch) =>
  chamar<{ id?: string }>(c, "POST", `/${conta(c)}/media_publish`, { corpo: { creation_id: id } }, buscar);

/** GET /{publicação}?fields=permalink (melhor esforço, para guardar o link no calendário). */
export const lerLink = (c: Config, id: string, buscar?: typeof fetch) =>
  chamar<{ permalink?: string }>(c, "GET", `/${encodeURIComponent(id)}`, { query: { fields: "permalink" } }, buscar);
