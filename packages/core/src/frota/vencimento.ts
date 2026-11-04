export type SituacaoVencimento = "VENCIDO" | "A_VENCER" | "EM_DIA";

const MS_DIA = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);

/** Dias de `de` até `ate` (datas AAAA-MM-DD); negativo se `ate` é anterior. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((ms(ate) - ms(de)) / MS_DIA);
}

export function somarDiasIso(iso: string, dias: number): string {
  return new Date(ms(iso) + dias * MS_DIA).toISOString().slice(0, 10);
}

/** Antecedência padrão do alerta de documentos (pedido do dono: 30 dias antes). */
export const ANTECEDENCIA_DOCUMENTO_DIAS = 30;

/** Vencido (venceu antes de hoje), a vencer (hoje até `antecedencia` dias) ou em dia. O dia do vencimento ainda vale. */
export function situacaoVencimento(vencimento: string, hoje: string, antecedencia = ANTECEDENCIA_DOCUMENTO_DIAS): SituacaoVencimento {
  const d = diasEntre(hoje, vencimento);
  if (d < 0) return "VENCIDO";
  return d <= antecedencia ? "A_VENCER" : "EM_DIA";
}
