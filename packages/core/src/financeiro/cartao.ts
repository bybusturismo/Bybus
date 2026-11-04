function ultimoDiaDoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function dataNoMes(ano: number, mes: number, dia: number): string {
  const total = ano * 12 + (mes - 1);
  const a = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${a}-${String(m).padStart(2, "0")}-${String(Math.min(dia, ultimoDiaDoMes(a, m))).padStart(2, "0")}`;
}

export interface FaturaDaData {
  /** Mês de referência da fatura = mês do fechamento ("AAAA-MM"). */
  referencia: string;
  fechamento: string;
  vencimento: string;
}

/**
 * Fatura a que uma compra pertence: compras até o dia do fechamento (inclusive) entram na fatura que fecha
 * naquele mês; as seguintes, na do mês seguinte. O vencimento é a primeira ocorrência do dia de vencimento
 * depois do fechamento. Dias inexistentes (31 em fevereiro) usam o último dia do mês.
 */
export function faturaDaData(data: string, diaFechamento: number, diaVencimento: number): FaturaDaData {
  const [a, m, d] = data.split("-").map(Number) as [number, number, number];
  const fechaEsteMes = d <= Math.min(diaFechamento, ultimoDiaDoMes(a, m));
  const base = a * 12 + (m - 1) + (fechaEsteMes ? 0 : 1);
  const ano = Math.floor(base / 12);
  const mes = (base % 12) + 1;
  const fechamento = dataNoMes(ano, mes, diaFechamento);
  const venceNoMesDoFechamento = diaVencimento > diaFechamento;
  const vencimento = dataNoMes(ano, mes + (venceNoMesDoFechamento ? 0 : 1), diaVencimento);
  return { referencia: `${ano}-${String(mes).padStart(2, "0")}`, fechamento, vencimento };
}
