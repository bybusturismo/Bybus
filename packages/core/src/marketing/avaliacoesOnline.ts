/**
 * Avaliações do Google e do Tripadvisor no sistema (dono, 18/11/2026): leitura diária pelas APIs oficiais
 * (perfil da empresa no Google; API de conteúdo do Tripadvisor) e resposta às do Google pelo sistema.
 */
export const CANAIS_AVALIACAO_ONLINE = ["GOOGLE", "TRIPADVISOR"] as const;
export type CanalAvaliacaoOnline = (typeof CANAIS_AVALIACAO_ONLINE)[number];
export const ROTULO_CANAL_AVALIACAO: Record<CanalAvaliacaoOnline, string> = { GOOGLE: "Google", TRIPADVISOR: "Tripadvisor" };

/** Nota do Google (enum ONE…FIVE) → 1 a 5; desconhecida → null. */
export function notaDoGoogle(starRating: unknown): number | null {
  const m: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return typeof starRating === "string" ? (m[starRating] ?? null) : null;
}

/** Número que pode vir como texto ("4.5", "1.234") → número; inválido → null. */
export function numeroDaApi(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Id do local do Tripadvisor a partir do link (…-g303576-d2362697-Reviews-…) ou do próprio número. */
export function idLocalTripadvisor(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const t = texto.trim();
  if (/^\d{3,12}$/.test(t)) return t;
  const m = t.match(/-d(\d{3,12})(?:-|$)/);
  return m ? m[1]! : null;
}

export interface ResumoAvaliacoes { quantidade: number; media: number | null; distribuicao: Record<1 | 2 | 3 | 4 | 5, number>; semResposta: number }

/** Resumo de um conjunto de avaliações (média com duas casas). `semResposta` conta as de nota até 3 sem resposta. */
export function resumirAvaliacoes(lista: ReadonlyArray<{ nota: number; resposta: string | null }>): ResumoAvaliacoes {
  const distribuicao = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  let soma = 0;
  for (const a of lista) { distribuicao[Math.min(5, Math.max(1, Math.round(a.nota))) as 1 | 2 | 3 | 4 | 5]++; soma += a.nota; }
  return {
    quantidade: lista.length,
    media: lista.length ? Math.round((soma / lista.length) * 100) / 100 : null,
    distribuicao,
    semResposta: lista.filter((a) => a.nota <= 3 && !a.resposta).length,
  };
}
