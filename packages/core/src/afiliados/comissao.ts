/**
 * Comissões de afiliados (regras do dono, 13/11/2026):
 * - O valor vem da Paytour (comissão do pedido); um pedido com várias reservas divide a comissão pelo valor de cada uma.
 * - Só vale depois que o cliente REALIZA o passeio: reserva cancelada ou passageiros que não compareceram não geram comissão.
 * - Pagamento quinzenal pela data do passeio: realizados de 01 a 15 → pagos no dia 16 do mesmo mês; de 16 ao fim do mês →
 *   pagos no dia 01 do mês seguinte.
 */

export type SituacaoComissao = "PREVISTA" | "A_PAGAR" | "CANCELADA" | "PAGA";

export const ROTULO_SITUACAO_COMISSAO: Record<SituacaoComissao, string> = {
  PREVISTA: "Prevista (passeio ainda não realizado)",
  A_PAGAR: "A pagar (passeio realizado)",
  CANCELADA: "Cancelada",
  PAGA: "Paga",
};

const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const iso = (ano: number, mes: number, dia: number) => `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;

/** Dia em que a comissão de um passeio realizado em `dataPasseio` é paga. */
export function dataPagamentoComissao(dataPasseio: string): string {
  const [a, m, d] = dataPasseio.split("-").map(Number) as [number, number, number];
  if (d <= 15) return iso(a, m, 16);
  return m === 12 ? iso(a + 1, 1, 1) : iso(a, m + 1, 1);
}

/** Período de passeios pago numa data de pagamento (dia 01 ou 16). */
export function periodoDoPagamento(dataPagamento: string): { de: string; ate: string } {
  const [a, m, d] = dataPagamento.split("-").map(Number) as [number, number, number];
  if (d === 16) return { de: iso(a, m, 1), ate: iso(a, m, 15) };
  if (d !== 1) throw new Error("Os pagamentos de comissão são nos dias 01 e 16.");
  const [pa, pm] = m === 1 ? [a - 1, 12] : [a, m - 1];
  return { de: iso(pa, pm, 16), ate: iso(pa, pm, ultimoDia(pa, pm)) };
}

/** Próxima data de pagamento (01 ou 16) a partir de hoje, inclusive. */
export function proximoPagamento(hoje: string): string {
  const [a, m, d] = hoje.split("-").map(Number) as [number, number, number];
  if (d === 1 || d === 16) return hoje;
  if (d < 16) return iso(a, m, 16);
  return m === 12 ? iso(a + 1, 1, 1) : iso(a, m + 1, 1);
}

/**
 * Divide a comissão do pedido entre as reservas pelo valor de cada uma, sem perder centavos (o resto vai para as primeiras).
 * Sem valor nas reservas, divide em partes iguais.
 */
export function ratearComissao(comissaoCentavos: number, valoresReservas: readonly number[]): number[] {
  const n = valoresReservas.length;
  if (n === 0 || comissaoCentavos <= 0) return valoresReservas.map(() => 0);
  const total = valoresReservas.reduce((a, v) => a + Math.max(0, v), 0);
  const pesos = total > 0 ? valoresReservas.map((v) => Math.max(0, v) / total) : valoresReservas.map(() => 1 / n);
  const partes = pesos.map((p) => Math.floor(comissaoCentavos * p));
  let resto = comissaoCentavos - partes.reduce((a, v) => a + v, 0);
  for (let i = 0; resto > 0; i = (i + 1) % n) { partes[i]!++; resto--; }
  return partes;
}

/**
 * Situação da comissão de uma reserva. `compareceu`: null = embarque não registrado (vale como realizado depois do dia, pois
 * a lista é conferida pelo guia), false = todos os passageiros marcados como "não veio".
 */
export function situacaoComissao(p: { reservaCancelada: boolean; dataPasseio: string; hoje: string; compareceu: boolean | null; paga: boolean }): SituacaoComissao {
  if (p.paga) return "PAGA";
  if (p.reservaCancelada || p.compareceu === false) return "CANCELADA";
  return p.dataPasseio < p.hoje ? "A_PAGAR" : "PREVISTA";
}
