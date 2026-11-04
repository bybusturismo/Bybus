import { diasEntre, somarDiasIso } from "./vencimento.js";

export type SituacaoPlano = "EM_DIA" | "PROXIMA" | "VENCIDA" | "SEM_BASE";

export interface EntradaPlano {
  intervaloKm?: number | null;
  intervaloDias?: number | null;
  /** Km e data da última execução (ou da instalação do plano). */
  ultimoKm?: number | null;
  ultimaData?: string | null;
  kmAtual: number;
  hoje: string;
  /** Avisar quando faltar até esta quilometragem / estes dias. */
  avisoKm?: number;
  avisoDias?: number;
}

export interface ResultadoPlano {
  situacao: SituacaoPlano;
  proximoKm: number | null;
  proximaData: string | null;
  /** Negativo = passou do ponto. */
  kmRestante: number | null;
  diasRestantes: number | null;
}

/**
 * Preventiva por km e/ou por tempo: vale o que chegar primeiro.
 * Sem base (sem km e sem data da última execução) o plano fica "SEM_BASE" até a primeira execução ser informada.
 */
export function situacaoPlano(e: EntradaPlano): ResultadoPlano {
  const avisoKm = e.avisoKm ?? 1000;
  const avisoDias = e.avisoDias ?? 30;
  const proximoKm = e.intervaloKm && e.ultimoKm != null ? e.ultimoKm + e.intervaloKm : null;
  const proximaData = e.intervaloDias && e.ultimaData ? somarDiasIso(e.ultimaData, e.intervaloDias) : null;
  const kmRestante = proximoKm == null ? null : proximoKm - e.kmAtual;
  const diasRestantes = proximaData == null ? null : diasEntre(e.hoje, proximaData);
  if (kmRestante == null && diasRestantes == null) return { situacao: "SEM_BASE", proximoKm, proximaData, kmRestante, diasRestantes };
  const vencida = (kmRestante != null && kmRestante < 0) || (diasRestantes != null && diasRestantes < 0);
  const proxima = (kmRestante != null && kmRestante <= avisoKm) || (diasRestantes != null && diasRestantes <= avisoDias);
  return { situacao: vencida ? "VENCIDA" : proxima ? "PROXIMA" : "EM_DIA", proximoKm, proximaData, kmRestante, diasRestantes };
}
