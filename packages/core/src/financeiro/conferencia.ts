/**
 * Prevenção de erros no saldo das contas (dono, 13/11/2026: uma transferência de R$ 25 mil foi registrada pela planilha e,
 * de novo, à mão em "A receber", e o saldo do Sicredi ficou R$ 25 mil acima do banco).
 */

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A descrição parece transferência entre contas, aplicação ou resgate (que não são receita nem despesa)? */
export function pareceTransferencia(descricao: string): boolean {
  const t = normalizar(descricao);
  // "transfer" sozinho é o serviço de busca no hotel (receita de verdade): só "transf" abreviado ou "transferência" contam.
  return /\btransf\b|\btransf\.|\btransferenc|\bentre contas\b|\bmesma titularidade\b|\baplicac(ao|oes)\b|\bresgate\b|\bpoupanca\b/.test(t);
}

export interface MovimentoConferencia {
  id: string;
  /** "LINHA" = linha de extrato/transferência; "LANCAMENTO" = lançamento baixado sem conciliar. */
  origem: "LINHA" | "LANCAMENTO";
  data: string;
  /** Com sinal: entrada positiva, saída negativa. */
  valorCentavos: number;
  descricao: string;
  transferencia: boolean;
  criadoPelaPlanilha: boolean;
}

export type MotivoSuspeita = "VALOR_DA_DIFERENCA" | "REPETIDO" | "TRANSFERENCIA_EM_DOBRO" | "PARECE_TRANSFERENCIA";

export interface Suspeito extends MovimentoConferencia { motivos: MotivoSuspeita[] }

const dias = (a: string, b: string) => Math.abs(new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000;

/**
 * Lista os movimentos que podem explicar a diferença entre o saldo do sistema e o do banco, mais prováveis primeiro:
 * valor igual à diferença (ou a soma de dois iguais a ela); o mesmo valor duas vezes em até 5 dias; lançamento à mão com o
 * mesmo valor de uma transferência; descrição de transferência lançada como receita/despesa. Depois, os maiores valores.
 */
export function suspeitosDaDiferenca(movs: readonly MovimentoConferencia[], diferencaCentavos: number, limite = 15): Suspeito[] {
  const saida: Suspeito[] = movs.map((m) => ({ ...m, motivos: [] }));
  for (const s of saida) {
    if (diferencaCentavos !== 0 && s.valorCentavos === diferencaCentavos) s.motivos.push("VALOR_DA_DIFERENCA");
    const outros = saida.filter((o) => o !== s && o.valorCentavos === s.valorCentavos && dias(o.data, s.data) <= 5);
    if (outros.length) {
      if (!s.transferencia && outros.some((o) => o.transferencia)) s.motivos.push("TRANSFERENCIA_EM_DOBRO");
      else if (!s.transferencia || outros.some((o) => o.transferencia)) s.motivos.push("REPETIDO");
    }
    if (s.origem === "LANCAMENTO" && pareceTransferencia(s.descricao)) s.motivos.push("PARECE_TRANSFERENCIA");
  }
  const peso = (s: Suspeito) =>
    (s.motivos.includes("VALOR_DA_DIFERENCA") ? 1000 : 0) + (s.motivos.includes("TRANSFERENCIA_EM_DOBRO") ? 500 : 0) +
    (s.motivos.includes("REPETIDO") ? 300 : 0) + (s.motivos.includes("PARECE_TRANSFERENCIA") ? 200 : 0);
  return saida
    .filter((s) => s.motivos.length > 0)
    .sort((a, b) => peso(b) - peso(a) || Math.abs(b.valorCentavos) - Math.abs(a.valorCentavos))
    .slice(0, limite);
}

export const ROTULO_SUSPEITA: Record<MotivoSuspeita, string> = {
  VALOR_DA_DIFERENCA: "valor igual à diferença",
  REPETIDO: "mesmo valor duas vezes em até 5 dias",
  TRANSFERENCIA_EM_DOBRO: "lançado à mão e também como transferência",
  PARECE_TRANSFERENCIA: "parece transferência lançada como receita/despesa",
};
