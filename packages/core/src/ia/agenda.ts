import { dataSaoPaulo } from "./custo.js";

/**
 * Próxima execução diária às HH:MM no horário de São Paulo (UTC−3 fixo: o Brasil não tem horário de verão desde 2019).
 * Sempre no futuro (se o horário de hoje já passou, devolve o de amanhã).
 */
export function proximaExecucao(agora: Date, horario = "06:30"): Date {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(horario);
  if (!m) throw new Error(`Horário inválido: ${horario} (use HH:MM)`);
  const [a, mes, dia] = dataSaoPaulo(agora).split("-").map(Number) as [number, number, number];
  const alvo = (d: number) => new Date(Date.UTC(a, mes - 1, d, Number(m[1]) + 3, Number(m[2])));
  const hoje = alvo(dia);
  return hoje.getTime() > agora.getTime() ? hoje : alvo(dia + 1);
}
