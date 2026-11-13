export interface AbastecimentoCalc {
  id: string;
  km: number;
  litros: number;
  tanqueCheio: boolean;
  /** COMBUSTIVEL (padrão), OLEO ou LUBRIFICANTE (13/11/2026): só combustível entra no km/l. */
  tipo?: string | null;
  /** Quando foi lançado: entre linhas do mesmo km, o km/l fica na lançada por último (o id é aleatório). */
  criadoEm?: Date | string | number | null;
}
const instante = (a: AbastecimentoCalc) => (a.criadoEm == null ? 0 : new Date(a.criadoEm).getTime() || 0);

export const TIPOS_ABASTECIMENTO = ["COMBUSTIVEL", "OLEO", "LUBRIFICANTE"] as const;
export type TipoAbastecimento = (typeof TIPOS_ABASTECIMENTO)[number];
export const ROTULO_TIPO_ABASTECIMENTO: Record<TipoAbastecimento, string> = { COMBUSTIVEL: "Combustível", OLEO: "Óleo", LUBRIFICANTE: "Lubrificante" };

/**
 * Consumo (km/l) entre tanques cheios: ao completar o tanque, km rodados desde o último tanque cheio
 * divididos pelos litros colocados desde então (inclusive este). Abastecimentos parciais entram na soma.
 * Devolve km/l por id (null quando não dá para calcular). A lista pode vir em qualquer ordem.
 */
export function consumoPorAbastecimento(lista: AbastecimentoCalc[]): Map<string, number | null> {
  const r = new Map<string, number | null>();
  for (const a of lista) r.set(a.id, null);
  // Só combustível; linhas com o mesmo km são o mesmo abastecimento (ex.: duas linhas de diesel no mesmo cupom, 13/11/2026):
  // os litros somam e o km/l fica na última linha.
  const porKm = new Map<number, AbastecimentoCalc[]>();
  for (const a of lista) if (!a.tipo || a.tipo === "COMBUSTIVEL") porKm.set(a.km, [...(porKm.get(a.km) ?? []), a]);
  const ordenada = [...porKm.entries()].sort((x, y) => x[0] - y[0]).map(([km, g]) => ({
    id: [...g].sort((x, y) => instante(x) - instante(y) || x.id.localeCompare(y.id)).at(-1)!.id, km, litros: g.reduce((t, x) => t + x.litros, 0), tanqueCheio: g.some((x) => x.tanqueCheio),
  }));
  let kmBase: number | null = null;
  let litros = 0;
  for (const a of ordenada) {
    if (kmBase == null) {
      r.set(a.id, null);
      if (a.tanqueCheio) { kmBase = a.km; litros = 0; }
      continue;
    }
    litros += a.litros;
    if (a.tanqueCheio) {
      const rodados = a.km - kmBase;
      r.set(a.id, rodados > 0 && litros > 0 ? Math.round((rodados / litros) * 100) / 100 : null);
      kmBase = a.km;
      litros = 0;
    } else {
      r.set(a.id, null);
    }
  }
  return r;
}

export function mediaConsumo(valores: Array<number | null | undefined>): number | null {
  const v = valores.filter((x): x is number => typeof x === "number" && x > 0);
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100 : null;
}

export const MINIMO_AMOSTRAS_MEDIA = 3;
export const TOLERANCIA_CONSUMO = 0.2;

/**
 * Alerta de consumo fora da média do próprio veículo: pior que a média em mais de 20% (gasto alto: vazamento,
 * desvio, problema mecânico) ou melhor em mais de 40% (provável km ou litros digitados errado).
 * A média usa só os cálculos anteriores e exige amostras suficientes.
 */
export function alertaConsumo(kml: number | null, anteriores: Array<number | null>): "ALTO" | "BAIXO" | null {
  if (kml == null) return null;
  const base = anteriores.filter((x): x is number => typeof x === "number" && x > 0);
  if (base.length < MINIMO_AMOSTRAS_MEDIA) return null;
  const media = base.reduce((s, x) => s + x, 0) / base.length;
  if (kml < media * (1 - TOLERANCIA_CONSUMO)) return "ALTO";
  if (kml > media * 1.4) return "BAIXO";
  return null;
}
