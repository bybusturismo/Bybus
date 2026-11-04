import type { FormaPagamento, TipoConta } from "./tipos";

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 123456 → "R$ 1.234,56". Só para exibição; as contas são sempre em centavos inteiros. */
export function formatarReais(centavos: number): string {
  return MOEDA.format(centavos / 100);
}

/**
 * Texto digitado pelo usuário → centavos inteiros, sem arredondar e sem ponto flutuante.
 * Aceita "1.234,56", "1234,56", "1234.56", "1234" e "R$ 10". Mais de duas casas decimais, negativo ou vazio → null.
 */
export function lerReais(texto: string): number | null {
  let s = texto.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s || !/^[\d.,]+$/.test(s)) return null;
  let inteiro: string;
  let fracao = "";
  if (s.includes(",")) {
    const partes = s.split(",");
    if (partes.length !== 2) return null;
    inteiro = partes[0]!.replace(/\./g, "");
    fracao = partes[1]!;
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [inteiro, fracao] = s.split(".") as [string, string];
  } else {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    if (!/^\d+$/.test(s)) return null;
    inteiro = s;
  }
  if (!/^\d+$/.test(inteiro || "0") || !/^\d{0,2}$/.test(fracao)) return null;
  const v = Number(inteiro || "0") * 100 + Number(fracao.padEnd(2, "0") || "0");
  return Number.isSafeInteger(v) ? v : null;
}

/** 123456 → "1234,56" (para preencher campos de edição). */
export function centavosParaCampo(centavos: number): string {
  return `${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, "0")}`;
}

export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  PIX: "PIX", BOLETO: "Boleto", TRANSFERENCIA: "Transferência", DEBITO: "Débito", CARTAO: "Cartão", DINHEIRO: "Dinheiro", OUTRA: "Outra",
};
export const ROTULO_TIPO_CONTA: Record<TipoConta, string> = {
  CORRENTE: "Conta corrente", APLICACAO: "Aplicação", CAIXA: "Caixa (dinheiro)", CARTAO: "Cartão de crédito",
};

export function nomeMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const t = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, 15)));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function somarMesAno(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Pontos-base (1234) → "12,34%". */
export function formatarMargem(pontosBase: number | null): string {
  if (pontosBase === null) return "—";
  return `${(pontosBase / 100).toFixed(2).replace(".", ",")}%`;
}

/**
 * Decodifica o arquivo de extrato: UTF-8 quando válido; senão Windows-1252
 * (muitos bancos brasileiros ainda exportam OFX nessa codificação).
 */
export function decodificarArquivo(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}
