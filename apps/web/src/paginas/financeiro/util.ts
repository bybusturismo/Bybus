import type { FormaPagamento, TipoConta } from "./tipos";

// Dinheiro, meses e datas usam os helpers comuns de ../../util/formato (formatarMoeda, centavosDeTexto, textoDeCentavos, nomeMes…).

export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  PIX: "PIX", BOLETO: "Boleto", TRANSFERENCIA: "Transferência", DEBITO: "Débito", CARTAO: "Cartão", DINHEIRO: "Dinheiro", OUTRA: "Outra",
};
export const ROTULO_TIPO_CONTA: Record<TipoConta, string> = {
  CORRENTE: "Conta corrente", APLICACAO: "Aplicação", CAIXA: "Caixa (dinheiro)", CARTAO: "Cartão de crédito",
};

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
