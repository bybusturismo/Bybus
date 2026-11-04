/** Preços em US$ por milhão de tokens (tabela da Anthropic de 06/10/2026). Modelo desconhecido usa o preço mais alto (prudência). */
export const PRECOS_MODELOS: Record<string, { entrada: number; saida: number }> = {
  "claude-opus-5-5": { entrada: 4, saida: 20 },
  "claude-opus-5": { entrada: 5, saida: 25 },
  "claude-sonnet-5-5": { entrada: 2, saida: 10 },
  "claude-sonnet-5": { entrada: 2, saida: 10 },
  "claude-haiku-5-5": { entrada: 0.1, saida: 0.5 },
  "claude-fable-5-1": { entrada: 10, saida: 50 },
  "claude-fable-5": { entrada: 10, saida: 50 },
};

const PRECO_PADRAO = { entrada: 10, saida: 50 };

export interface UsoTokens {
  entrada: number;
  saida: number;
  cacheLeitura?: number;
  cacheEscrita?: number;
}

/** Custo em micro-dólares (US$ 1 = 1.000.000), inteiro. Leitura de cache = 10% da entrada; escrita = 125%. */
export function custoMicroUsd(modelo: string, uso: UsoTokens): number {
  const p = PRECOS_MODELOS[modelo] ?? PRECO_PADRAO;
  const usd =
    (uso.entrada * p.entrada + uso.saida * p.saida + (uso.cacheLeitura ?? 0) * p.entrada * 0.1 + (uso.cacheEscrita ?? 0) * p.entrada * 1.25) / 1_000_000;
  return Math.ceil(Math.round(usd * 1_000_000 * 1000) / 1000);
}

export const microParaUsd = (micro: number): number => Math.round(micro) / 1_000_000;

/** Data "AAAA-MM-DD" no fuso America/Sao_Paulo. */
export function dataSaoPaulo(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/** Competência "AAAA-MM" no fuso America/Sao_Paulo (o limite mensal vale por mês de São Paulo). */
export function mesSaoPaulo(d: Date): string {
  return dataSaoPaulo(d).slice(0, 7);
}

export function limiteAtingido(gastoMicro: number, limiteUsd: number): boolean {
  return limiteUsd > 0 && gastoMicro >= limiteUsd * 1_000_000;
}
