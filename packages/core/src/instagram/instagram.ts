/**
 * Regras puras do Instagram (Instagram API com Instagram Login, da Meta). Valores marcados "a confirmar"
 * dependem da documentação oficial da Meta no momento da conexão (ver docs/produto/modulo-instagram.md).
 */

// ---------------------------------------------------------------- Direct: janela de 24 horas

/** Regra da Meta: só se responde a um Direct até 24 h depois da última mensagem DO CLIENTE. */
export const JANELA_RESPOSTA_HORAS = 24;

export interface JanelaResposta {
  aberta: boolean;
  /** Quando a janela fecha (nulo se o cliente nunca escreveu). */
  expiraEm: Date | null;
  /** Minutos que ainda restam (0 quando fechada). */
  minutosRestantes: number;
}

export function janelaResposta(ultimaEntradaEm: Date | string | null | undefined, agora: Date = new Date()): JanelaResposta {
  if (!ultimaEntradaEm) return { aberta: false, expiraEm: null, minutosRestantes: 0 };
  const inicio = new Date(ultimaEntradaEm);
  if (Number.isNaN(inicio.getTime())) return { aberta: false, expiraEm: null, minutosRestantes: 0 };
  const expiraEm = new Date(inicio.getTime() + JANELA_RESPOSTA_HORAS * 3_600_000);
  const restante = expiraEm.getTime() - agora.getTime();
  return { aberta: restante > 0, expiraEm, minutosRestantes: restante > 0 ? Math.floor(restante / 60_000) : 0 };
}

// ---------------------------------------------------------------- Postagens agendadas

export const TIPOS_POST_INSTAGRAM = ["IMAGEM", "CARROSSEL", "REELS", "STORY"] as const;
export type TipoPostInstagram = (typeof TIPOS_POST_INSTAGRAM)[number];

/** STORY: suporte da API de publicação a confirmar na doc oficial. */
export const ROTULO_TIPO_POST: Record<TipoPostInstagram, string> = { IMAGEM: "Imagem", CARROSSEL: "Carrossel", REELS: "Reels", STORY: "Story (a confirmar)" };

export const STATUS_PUBLICACAO = ["AGENDADO", "PUBLICANDO", "PUBLICADO", "FALHOU"] as const;
export type StatusPublicacao = (typeof STATUS_PUBLICACAO)[number];

export const LEGENDA_MAX = 2200;
/** A confirmar na doc oficial: limite de hashtags por post. */
export const HASHTAGS_MAX = 30;
export const CARROSSEL_MIN = 2;
export const CARROSSEL_MAX = 10;
/** A confirmar na doc oficial: publicações pela API por conta em 24 h. A API informa o uso real (content_publishing_limit). */
export const LIMITE_PUBLICACOES_DIA = 100;
/** Antecedência mínima para agendar (dá tempo de revisar) e horizonte máximo. */
export const ANTECEDENCIA_MIN_MINUTOS = 5;
export const HORIZONTE_MAX_DIAS = 365;
/** Tentativas de publicação antes de marcar "falhou". */
export const TENTATIVAS_PUBLICACAO = 3;

export interface MidiaAgendamento { uso: "IMAGEM" | "VIDEO" | "ARQUIVO"; tipo: string }

export interface EntradaAgendamento {
  rede: string;
  tipo: TipoPostInstagram;
  legenda: string | null | undefined;
  agendarEm: Date | null | undefined;
  midias: MidiaAgendamento[];
  agora?: Date;
}

/** Erros (em português, para a tela) que impedem agendar. Lista vazia = pode agendar. */
export function validarAgendamento(e: EntradaAgendamento): string[] {
  const erros: string[] = [];
  const agora = e.agora ?? new Date();
  if (e.rede !== "INSTAGRAM") erros.push("Só é possível agendar posts do Instagram.");
  const legenda = e.legenda ?? "";
  if (legenda.length > LEGENDA_MAX) erros.push(`A legenda pode ter até ${LEGENDA_MAX} caracteres.`);
  if (contarHashtags(legenda) > HASHTAGS_MAX) erros.push(`Use no máximo ${HASHTAGS_MAX} hashtags.`);
  if (!e.agendarEm || Number.isNaN(e.agendarEm.getTime())) erros.push("Informe a data e a hora da publicação.");
  else {
    if (e.agendarEm.getTime() < agora.getTime() + ANTECEDENCIA_MIN_MINUTOS * 60_000) erros.push(`Agende com pelo menos ${ANTECEDENCIA_MIN_MINUTOS} minutos de antecedência.`);
    if (e.agendarEm.getTime() > agora.getTime() + HORIZONTE_MAX_DIAS * 86_400_000) erros.push("A data está longe demais (máximo de 1 ano).");
  }
  const imagens = e.midias.filter((m) => m.uso === "IMAGEM");
  const videos = e.midias.filter((m) => m.uso === "VIDEO");
  if (e.midias.some((m) => m.uso === "ARQUIVO")) erros.push("Anexe só imagens ou vídeos.");
  // O Instagram só aceita imagem JPEG e vídeo MP4/MOV na publicação pela API (a confirmar na doc oficial).
  if (imagens.some((m) => m.tipo !== "image/jpeg")) erros.push("As imagens precisam ser JPEG (.jpg).");
  if (videos.some((m) => m.tipo !== "video/mp4")) erros.push("Os vídeos precisam ser MP4.");
  const n = e.midias.length;
  switch (e.tipo) {
    case "IMAGEM": if (!(n === 1 && imagens.length === 1)) erros.push("Post de imagem: anexe exatamente 1 imagem."); break;
    case "REELS": if (!(n === 1 && videos.length === 1)) erros.push("Reels: anexe exatamente 1 vídeo."); break;
    case "STORY": if (n !== 1) erros.push("Story: anexe exatamente 1 imagem ou vídeo."); break;
    case "CARROSSEL": if (n < CARROSSEL_MIN || n > CARROSSEL_MAX) erros.push(`Carrossel: anexe de ${CARROSSEL_MIN} a ${CARROSSEL_MAX} imagens ou vídeos.`); break;
  }
  return erros;
}

export function contarHashtags(texto: string): number {
  return (texto.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

/** Espera antes da próxima tentativa (backoff exponencial: 2, 4, 8… minutos, no máximo 30). */
export function esperaTentativaMinutos(tentativasFeitas: number): number {
  return Math.min(30, 2 ** Math.max(1, tentativasFeitas));
}

/** Erro transitório (vale tentar de novo): rede, limite de chamadas ou erro do servidor da Meta. */
export function erroTransitorio(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

// ---------------------------------------------------------------- Análise dos dados (Marketing)

export interface PostMetricas {
  id: string;
  publicadoEm: Date | string | null;
  curtidas: number | null;
  comentarios: number | null;
  salvamentos: number | null;
  compartilhamentos: number | null;
  alcance: number | null;
}

/** Engajamento = curtidas + comentários + salvamentos + compartilhamentos (o que faltar conta 0). */
export function engajamentoDoPost(p: Pick<PostMetricas, "curtidas" | "comentarios" | "salvamentos" | "compartilhamentos">): number {
  return (p.curtidas ?? 0) + (p.comentarios ?? 0) + (p.salvamentos ?? 0) + (p.compartilhamentos ?? 0);
}

/** Taxa de engajamento sobre o alcance (0–1+); nula sem alcance. */
export function taxaEngajamento(p: PostMetricas): number | null {
  return p.alcance && p.alcance > 0 ? engajamentoDoPost(p) / p.alcance : null;
}

export function rankingPosts<T extends PostMetricas>(posts: T[], limite = 10): Array<T & { engajamento: number; taxa: number | null }> {
  return posts.map((p) => ({ ...p, engajamento: engajamentoDoPost(p), taxa: taxaEngajamento(p) }))
    .sort((a, b) => b.engajamento - a.engajamento || String(a.id).localeCompare(String(b.id)))
    .slice(0, limite);
}

export interface MelhoresHorarios {
  porDiaSemana: Array<{ dia: number; posts: number; engajamentoMedio: number }>;
  porHora: Array<{ hora: number; posts: number; engajamentoMedio: number }>;
  /** Combinação dia × hora de maior engajamento médio (precisa de pelo menos 2 posts nela para valer); nula se não houver. */
  melhor: { dia: number; hora: number; posts: number; engajamentoMedio: number } | null;
}

export const NOMES_DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

/** Dia da semana (0 = domingo) e hora de um instante no fuso informado. */
export function diaEHora(quando: Date, fuso = "America/Sao_Paulo"): { dia: number; hora: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: fuso, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(quando);
  const sem = p.find((x) => x.type === "weekday")!.value;
  const hora = Number(p.find((x) => x.type === "hour")!.value);
  return { dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(sem), hora };
}

/** Engajamento médio por dia da semana e por hora (America/Sao_Paulo), a partir dos posts com data. */
export function melhoresHorarios(posts: PostMetricas[], fuso = "America/Sao_Paulo"): MelhoresHorarios {
  const dias = new Map<number, number[]>();
  const horas = new Map<number, number[]>();
  const combos = new Map<string, number[]>();
  for (const p of posts) {
    if (!p.publicadoEm) continue;
    const d = new Date(p.publicadoEm);
    if (Number.isNaN(d.getTime())) continue;
    const { dia, hora } = diaEHora(d, fuso);
    const e = engajamentoDoPost(p);
    for (const [mapa, chave] of [[dias, dia], [horas, hora]] as const) mapa.set(chave, [...(mapa.get(chave) ?? []), e]);
    combos.set(`${dia}-${hora}`, [...(combos.get(`${dia}-${hora}`) ?? []), e]);
  }
  const media = (v: number[]) => Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10;
  const porDiaSemana = [...dias].map(([dia, v]) => ({ dia, posts: v.length, engajamentoMedio: media(v) })).sort((a, b) => a.dia - b.dia);
  const porHora = [...horas].map(([hora, v]) => ({ hora, posts: v.length, engajamentoMedio: media(v) })).sort((a, b) => a.hora - b.hora);
  const candidatos = [...combos].filter(([, v]) => v.length >= 2).map(([k, v]) => {
    const [dia, hora] = k.split("-").map(Number) as [number, number];
    return { dia, hora, posts: v.length, engajamentoMedio: media(v) };
  }).sort((a, b) => b.engajamentoMedio - a.engajamentoMedio || a.dia - b.dia || a.hora - b.hora);
  return { porDiaSemana, porHora, melhor: candidatos[0] ?? null };
}
