/** Formatação pt-BR. Datas do banco: "AAAA-MM-DD" (dia civil) ou ISO UTC (instante) → exibidas em America/Sao_Paulo. */

export const FUSO = "America/Sao_Paulo";

/** Data civil "AAAA-MM-DD" como Date ao meio-dia UTC (evita trocar de dia por fuso). */
function dataCivil(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a!, (m ?? 1) - 1, d ?? 1, 12));
}

/** "2026-10-23" → "23/10/2026" */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** "2026-10-23" → "Sexta-feira, 23 de outubro de 2026" (só a primeira letra maiúscula). */
export function formatarDataExtenso(iso: string): string {
  const t = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(dataCivil(iso));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "2026-10-23" → "sex., 23 de out." (rótulos curtos) */
export function formatarDataCurta(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(dataCivil(iso));
}

/** "2026-10-23" → { semana: "sex", dia: "23", mes: "out" } (bloco de calendário). */
export function partesData(iso: string): { semana: string; dia: string; mes: string } {
  const d = dataCivil(iso);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { ...o, timeZone: "UTC" }).format(d).replace(".", "");
  return { semana: f({ weekday: "short" }), dia: f({ day: "numeric" }), mes: f({ month: "short" }) };
}

/** Instante ISO (UTC) → "23/10/2026 14:05" no horário de Brasília. */
export function formatarDataHora(instante: string | Date | null | undefined): string {
  if (!instante) return "";
  const d = typeof instante === "string" ? new Date(instante) : instante;
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")}`;
}

/** Hoje (dia civil em America/Sao_Paulo) como "AAAA-MM-DD". */
export function hojeIso(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** Soma dias a uma data civil "AAAA-MM-DD". */
export function somarDias(iso: string, dias: number): string {
  const d = dataCivil(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Lista de datas civis de `inicio` (inclusive) por `n` dias. */
export function intervaloDias(inicio: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => somarDias(inicio, i));
}

/** Diferença em dias entre duas datas civis (b - a). */
export function diferencaDias(a: string, b: string): number {
  return Math.round((dataCivil(b).getTime() - dataCivil(a).getTime()) / 86_400_000);
}

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** Centavos → "R$ 1.234,56" (espaço normal, não o NBSP do Intl). */
export function formatarMoeda(centavos: number): string {
  return moeda.format(centavos / 100).replace(/ /g, " ");
}

export function formatarNumero(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(n);
}

/** Plural simples: plural(2, "passageiro") → "2 passageiros". */
export function plural(n: number, singular: string, pluralForma = `${singular}s`): string {
  return `${formatarNumero(n)} ${n === 1 ? singular : pluralForma}`;
}

/**
 * Texto digitado em reais → centavos (inteiro). Aceita "300", "300,5", "1.234,56", "R$ 1.234,56".
 * Retorna null se vazio e NaN se inválido.
 */
export function centavosDeTexto(texto: string): number | null {
  const t = texto.replace(/R\$/i, "").replace(/\s/g, "");
  if (!t) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return Number.NaN;
  const [inteiro, decimal = ""] = t.replace(/\./g, "").split(",");
  return Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
}

/** Centavos → texto editável "1.234,56" (sem "R$"). */
export function textoDeCentavos(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return "";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100);
}

export type SituacaoValidade = "vencido" | "vencendo" | "ok";

/** Documento com validade (CNH, Cadastur): vencido, vencendo em até `dias` dias, ou ok. */
export function situacaoValidade(validade: string | null | undefined, hoje: string, dias = 30): SituacaoValidade | null {
  if (!validade) return null;
  const d = diferencaDias(hoje, validade.slice(0, 10));
  if (d < 0) return "vencido";
  if (d <= dias) return "vencendo";
  return "ok";
}
