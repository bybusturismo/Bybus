/** Dinheiro em centavos (inteiros). Nada aqui usa ponto flutuante para somar ou dividir valores. */

/**
 * Converte texto em centavos sem arredondar: "1.234,56", "1234.56", "R$ 10,00", "(10,00)", "10,00 D", "-5".
 * Devolve `null` quando o texto não é um valor reconhecível ou tem mais de duas casas decimais.
 * Sinal: "-", parênteses ou sufixo D/DB (débito) deixam o valor negativo.
 */
export function paraCentavos(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  let s = String(texto).trim();
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (/(^|\s)-|-$/.test(s)) negativo = true;
  if (/\d\s*(D|DB)$/i.test(s)) negativo = true;
  s = s.replace(/R\$/gi, "").replace(/\s*(DB|CR|D|C)$/i, "").replace(/[\s+-]/g, "");
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const ultimoPonto = s.lastIndexOf(".");
  const ultimaVirgula = s.lastIndexOf(",");
  let inteiro: string;
  let fracao = "";
  if (ultimoPonto >= 0 && ultimaVirgula >= 0) {
    const dec = Math.max(ultimoPonto, ultimaVirgula);
    const milhar = dec === ultimoPonto ? "," : ".";
    inteiro = s.slice(0, dec).split(milhar).join("");
    fracao = s.slice(dec + 1);
    if (/[.,]/.test(inteiro)) return null;
  } else if (ultimaVirgula >= 0 || ultimoPonto >= 0) {
    const sep = ultimaVirgula >= 0 ? "," : ".";
    const partes = s.split(sep);
    const ultima = partes.at(-1)!;
    if (partes.length === 2 && ultima.length >= 1 && ultima.length <= 2) {
      inteiro = partes[0]!;
      fracao = ultima;
    } else if (!(sep === "," && partes.length === 2) && partes.length >= 2 && partes.slice(1).every((p) => p.length === 3) && partes[0]!.length >= 1 && partes[0]!.length <= 3) {
      // "1.234" é milhar (BR); "12,345" é ambíguo (vírgula é decimal no Brasil) e é recusado em vez de adivinhado.
      inteiro = partes.join(""); // separador de milhar
    } else return null;
  } else inteiro = s;
  if (!/^\d*$/.test(inteiro) || !/^\d{0,2}$/.test(fracao)) return null;
  const valor = Number(inteiro || "0") * 100 + Number(fracao.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(valor)) return null;
  return negativo ? -valor : valor;
}

/** 123456 → "1.234,56" (sem símbolo); negativo vira "-1.234,56". */
export function centavosParaTexto(centavos: number): string {
  const neg = centavos < 0;
  const abs = Math.abs(centavos);
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${reais},${String(abs % 100).padStart(2, "0")}`;
}

/** Divide o total em `n` parcelas sem perder centavos: as primeiras parcelas recebem 1 centavo a mais do resto. */
export function parcelar(totalCentavos: number, n: number): number[] {
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) throw new Error("O valor total deve ser um inteiro positivo em centavos.");
  if (!Number.isInteger(n) || n < 1 || n > 360) throw new Error("Número de parcelas inválido.");
  if (totalCentavos < n) throw new Error("O valor total não pode ser menor que o número de parcelas (1 centavo por parcela).");
  const base = Math.floor(totalCentavos / n);
  const resto = totalCentavos - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
}

export function ehDataIso(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const x = new Date(Date.UTC(a, mes - 1, d));
  return x.getUTCFullYear() === a && x.getUTCMonth() === mes - 1 && x.getUTCDate() === d;
}

/** Soma meses a uma data civil mantendo o dia (31/01 + 1 mês = 28/02 ou 29/02). */
export function somarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

/** a − b em dias (datas civis). */
export function diferencaDias(a: string, b: string): number {
  const t = (s: string) => { const [x, y, z] = s.split("-").map(Number) as [number, number, number]; return Date.UTC(x, y - 1, z); };
  return Math.round((t(a) - t(b)) / 86_400_000);
}

export interface BaixaEntrada {
  valorCentavos: number;
  jurosCentavos?: number;
  multaCentavos?: number;
  descontoCentavos?: number;
}

/**
 * Valor efetivamente pago/recebido = valor + juros + multa − desconto.
 * Tudo em centavos inteiros; o desconto não pode zerar nem ultrapassar o total.
 */
export function calcularBaixa(b: BaixaEntrada): number {
  const juros = b.jurosCentavos ?? 0;
  const multa = b.multaCentavos ?? 0;
  const desconto = b.descontoCentavos ?? 0;
  for (const v of [b.valorCentavos, juros, multa, desconto]) {
    if (!Number.isInteger(v) || v < 0) throw new Error("Valores da baixa devem ser inteiros não negativos em centavos.");
  }
  const total = b.valorCentavos + juros + multa - desconto;
  if (total <= 0) throw new Error("O desconto não pode ser igual ou maior que o valor devido.");
  return total;
}
