import { diaNoMes, somarMeses } from "./dinheiro.js";

export interface FaturaDaData {
  /** Mês de referência da fatura = mês do fechamento ("AAAA-MM"). */
  referencia: string;
  fechamento: string;
  vencimento: string;
}

/**
 * Fatura a que uma compra pertence: compras até o dia do fechamento (inclusive) entram na fatura que fecha
 * naquele mês; as seguintes, na do mês seguinte. O vencimento é a primeira ocorrência do dia de vencimento
 * estritamente depois do fechamento. Dias inexistentes (31 em fevereiro) usam o último dia do mês.
 */
export function faturaDaData(data: string, diaFechamento: number, diaVencimento: number): FaturaDaData {
  const mesCompra = data.slice(0, 7);
  const fechaEsteMes = data <= diaNoMes(mesCompra, diaFechamento);
  const referencia = fechaEsteMes ? mesCompra : somarMeses(`${mesCompra}-01`, 1).slice(0, 7);
  const fechamento = diaNoMes(referencia, diaFechamento);
  let mesVenc = diaVencimento > diaFechamento ? referencia : somarMeses(`${referencia}-01`, 1).slice(0, 7);
  let vencimento = diaNoMes(mesVenc, diaVencimento);
  if (vencimento <= fechamento) {
    // Mês curto com o dia limitado ao último dia: o vencimento nunca coincide com o fechamento nem o antecede.
    mesVenc = somarMeses(`${mesVenc}-01`, 1).slice(0, 7);
    vencimento = diaNoMes(mesVenc, diaVencimento);
  }
  return { referencia, fechamento, vencimento };
}
