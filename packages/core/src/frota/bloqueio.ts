import { situacaoVencimento } from "./vencimento.js";
import type { SituacaoVeiculo } from "./tipos.js";

export interface EntradaBloqueio {
  situacao: SituacaoVeiculo;
  documentos: Array<{ tipo: string; descricao?: string | null; vencimento: string }>;
  planos: Array<{ nome: string; critico: boolean; situacao: string }>;
  /** Ordens abertas/em andamento que imobilizam o veículo. */
  ordensImobilizando: number;
  hoje: string;
}

/**
 * Motivos que bloqueiam o veículo na escala/saídas: documento vencido, manutenção crítica pendente
 * (preventiva crítica vencida ou ordem que imobiliza) ou veículo fora de operação.
 * Lista vazia = disponível.
 */
export function motivosBloqueio(e: EntradaBloqueio): string[] {
  const m: string[] = [];
  if (e.situacao === "INATIVO") m.push("Veículo inativo");
  if (e.situacao === "MANUTENCAO") m.push("Veículo em manutenção");
  for (const d of e.documentos) if (situacaoVencimento(d.vencimento, e.hoje) === "VENCIDO") m.push(`Documento vencido: ${d.descricao || d.tipo}`);
  for (const p of e.planos) if (p.critico && p.situacao === "VENCIDA") m.push(`Manutenção crítica vencida: ${p.nome}`);
  if (e.ordensImobilizando > 0 && e.situacao !== "MANUTENCAO") m.push("Ordem de manutenção crítica aberta");
  return m;
}
