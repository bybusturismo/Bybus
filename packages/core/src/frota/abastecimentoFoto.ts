import type { FormaPagamento } from "../financeiro/plano.js";
import { normalizarPlaca, placaValida } from "./tipos.js";

/**
 * Abastecimento pela foto do cupom (dono, 18/11/2026): o motorista manda a foto (app ou WhatsApp), o sistema lê e abre um
 * abastecimento PENDENTE; quem gerencia a frota confere (vira CONFERIDO, entra no km/l e gera a conta a pagar no Financeiro);
 * o pagamento (baixa com comprovante) é do Financeiro.
 */
export const SITUACOES_ABASTECIMENTO = ["PENDENTE", "CONFERIDO"] as const;
export type SituacaoAbastecimento = (typeof SITUACOES_ABASTECIMENTO)[number];

export const ORIGENS_ABASTECIMENTO = ["MANUAL", "APP", "WHATSAPP"] as const;
export type OrigemAbastecimento = (typeof ORIGENS_ABASTECIMENTO)[number];

/** Como o combustível é pago (dono, 18/11/2026: BC faturado no posto; Florianópolis em dinheiro, passando para cartão de crédito). */
export const FORMAS_PAGAMENTO_COMBUSTIVEL = ["FATURADO", "CARTAO", "DINHEIRO", "PIX"] as const;
export type FormaPagamentoCombustivel = (typeof FORMAS_PAGAMENTO_COMBUSTIVEL)[number];
export const ROTULO_FORMA_COMBUSTIVEL: Record<FormaPagamentoCombustivel, string> = {
  FATURADO: "Faturado no posto", CARTAO: "Cartão de crédito", DINHEIRO: "Dinheiro", PIX: "PIX",
};
/** Forma de pagamento do Financeiro correspondente (FORMAS_PAGAMENTO do financeiro). */
export const FORMA_FINANCEIRO_DO_COMBUSTIVEL: Record<FormaPagamentoCombustivel, FormaPagamento> = {
  FATURADO: "BOLETO", CARTAO: "CARTAO", DINHEIRO: "DINHEIRO", PIX: "PIX",
};

export const TIPOS_FOTO_ABASTECIMENTO = ["CUPOM", "HODOMETRO", "OUTRO"] as const;
export type TipoFotoAbastecimento = (typeof TIPOS_FOTO_ABASTECIMENTO)[number];

export interface ConfigPagamentoPraca { forma: FormaPagamentoCombustivel; prazoDias: number }

/** Padrão por praça enquanto a configuração não for salva (a confirmar com o dono: prazo da fatura do posto em BC). */
export function configPagamentoPadrao(codigoPraca: string): ConfigPagamentoPraca {
  return codigoPraca.toUpperCase() === "BC" ? { forma: "FATURADO", prazoDias: 30 } : { forma: "CARTAO", prazoDias: 0 };
}

/** Vencimento da conta a pagar: faturado = data + prazo da fatura; cartão, dinheiro e PIX = a própria data. */
export function vencimentoCombustivel(data: string, cfg: ConfigPagamentoPraca): string {
  if (cfg.forma !== "FATURADO" || cfg.prazoDias <= 0) return data;
  return new Date(Date.parse(`${data}T12:00:00Z`) + cfg.prazoDias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Lê placa e km do texto que acompanha a foto (legenda) ou da resposta do motorista: "TST1A11 120500", "placa tst-1a11 km 120.500".
 * O km é o maior número de 3 a 7 dígitos (pontos de milhar aceitos) que não faz parte da placa.
 */
export function lerLegendaAbastecimento(texto: string | null | undefined): { placa: string | null; km: number | null } {
  if (!texto) return { placa: null, km: null };
  const t = texto.toUpperCase();
  let placa: string | null = null;
  for (const m of t.matchAll(/\b([A-Z]{3})[\s-]?(\d[A-Z0-9]\d{2})\b/g)) {
    const p = normalizarPlaca(m[1]! + m[2]!);
    if (placaValida(p)) { placa = p; break; }
  }
  const semPlaca = placa ? t.replace(/\b[A-Z]{3}[\s-]?\d[A-Z0-9]\d{2}\b/g, " ") : t;
  const numeros = [...semPlaca.matchAll(/(?<![\d,])(\d{1,3}(?:\.\d{3})+|\d{3,7})(?![\d,])/g)].map((m) => Number(m[1]!.replace(/\./g, ""))).filter((n) => n >= 100 && n <= 5_000_000);
  return { placa, km: numeros.length ? Math.max(...numeros) : null };
}

/** O que ainda falta para conferir um abastecimento pendente. */
export function faltasAbastecimento(a: { veiculoId: string | null; km: number | null; litros: number | null; valorCentavos: number | null }): string[] {
  const f: string[] = [];
  if (!a.veiculoId) f.push("placa");
  if (a.km == null) f.push("km do painel");
  if (!a.litros || a.litros <= 0) f.push("litros");
  if (a.valorCentavos == null || a.valorCentavos <= 0) f.push("valor");
  return f;
}
