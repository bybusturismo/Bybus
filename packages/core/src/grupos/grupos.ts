/**
 * Grupos fechados (dono, 13/11/2026). Regra geral: 50% antecipado para reservar a data e o restante até a realização;
 * cancelamento pelo grupo não devolve o antecipado (remarcação ou crédito em até 1 ano). Cada caso pode ser ajustado.
 */

export const STATUS_GRUPO = ["ORCAMENTO", "CONFIRMADO", "REALIZADO", "CANCELADO"] as const;
export type StatusGrupo = (typeof STATUS_GRUPO)[number];
export const ROTULO_STATUS_GRUPO: Record<StatusGrupo, string> = { ORCAMENTO: "Orçamento", CONFIRMADO: "Confirmado", REALIZADO: "Realizado", CANCELADO: "Cancelado" };
export const TIPOS_ANEXO_GRUPO = ["CONTRATO", "COMPROVANTE", "LISTA", "NF", "OUTRO"] as const;
export type TipoAnexoGrupo = (typeof TIPOS_ANEXO_GRUPO)[number];
export const ROTULO_ANEXO_GRUPO: Record<TipoAnexoGrupo, string> = { CONTRATO: "Contrato", COMPROVANTE: "Comprovante de pagamento", LISTA: "Lista de passageiros", NF: "Nota fiscal", OUTRO: "Outro" };
export const SINAL_PADRAO_PERCENTUAL = 50;

/** Total: valor por pessoa × pessoas, respeitando o mínimo contratado (abaixo do mínimo, cobra o mínimo). */
export function totalDoGrupo(p: { valorPorPessoaCentavos: number | null; pessoas: number | null; pessoasMinimo: number | null }): number | null {
  if (p.valorPorPessoaCentavos == null || p.pessoas == null) return null;
  return p.valorPorPessoaCentavos * Math.max(p.pessoas, p.pessoasMinimo ?? 0);
}

export interface ParcelaGrupo { tipo: "SINAL" | "SALDO" | "INTEGRAL"; descricao: string; valorCentavos: number; vencimento: string }

/**
 * Cobrança do grupo: sinal (% do total) até `vencimentoSinal` e saldo até o dia do passeio. 100% (ou sem data do passeio):
 * uma parcela integral. Os centavos que sobram ficam no saldo.
 */
export function planoDeCobranca(p: { totalCentavos: number; sinalPercentual: number; vencimentoSinal: string; dataPasseio: string | null }): ParcelaGrupo[] {
  if (p.totalCentavos <= 0) return [];
  const pct = Math.min(100, Math.max(0, Math.round(p.sinalPercentual)));
  if (pct >= 100 || !p.dataPasseio) return [{ tipo: "INTEGRAL", descricao: "Pagamento integral", valorCentavos: p.totalCentavos, vencimento: p.vencimentoSinal }];
  if (pct === 0) return [{ tipo: "SALDO", descricao: "Pagamento até o dia do passeio", valorCentavos: p.totalCentavos, vencimento: p.dataPasseio }];
  const sinal = Math.floor((p.totalCentavos * pct) / 100);
  return [
    { tipo: "SINAL", descricao: `Sinal (${pct}%) para reservar a data`, valorCentavos: sinal, vencimento: p.vencimentoSinal },
    { tipo: "SALDO", descricao: "Saldo até o dia do passeio", valorCentavos: p.totalCentavos - sinal, vencimento: p.dataPasseio },
  ];
}

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]!);
  if (r) partes.push(r < 20 ? UNIDADES[r]! : DEZENAS[Math.floor(r / 10)]! + (r % 10 ? ` e ${UNIDADES[r % 10]}` : ""));
  return partes.join(" e ");
}

function inteiroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  const grupos = [
    { valor: Math.floor(n / 1_000_000_000) % 1000, sing: "bilhão", plur: "bilhões" },
    { valor: Math.floor(n / 1_000_000) % 1000, sing: "milhão", plur: "milhões" },
    { valor: Math.floor(n / 1000) % 1000, sing: "mil", plur: "mil" },
    { valor: n % 1000, sing: "", plur: "" },
  ].filter((g) => g.valor > 0);
  return grupos.map((g, i) => {
    const txt = g.sing === "mil" && g.valor === 1 ? "mil" : `${ate999(g.valor)}${g.sing ? ` ${g.valor === 1 ? g.sing : g.plur}` : ""}`;
    // "e" antes do último grupo quando ele é menor que 100 ou centena redonda (ex.: "mil e duzentos", "dois mil e cinquenta").
    const ultimo = i === grupos.length - 1 && i > 0;
    return ultimo && (g.valor < 100 || g.valor % 100 === 0) ? `e ${txt}` : txt;
  }).join(" ").replace(/ e e /g, " e ");
}

/** 325000 → "três mil duzentos e cinquenta reais"; 162550 → "mil seiscentos e vinte e cinco reais e cinquenta centavos". */
export function valorPorExtenso(centavos: number): string {
  const reais = Math.floor(Math.abs(centavos) / 100);
  const cent = Math.abs(centavos) % 100;
  const partes: string[] = [];
  if (reais > 0) {
    const t = inteiroPorExtenso(reais);
    const de = reais >= 1_000_000 && reais % 1_000_000 === 0 ? " de" : "";
    partes.push(`${t}${de} ${reais === 1 ? "real" : "reais"}`);
  }
  if (cent > 0) partes.push(`${inteiroPorExtenso(cent)} ${cent === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero reais";
}
