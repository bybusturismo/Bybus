/**
 * Diário de km (dono, 18/11/2026): por dia e veículo, km inicial, km final e consumo (litros gastos no dia).
 * Km rodado = final − inicial; km/l = rodado ÷ litros. O km inicial de um dia deve bater com o km final do registro anterior
 * do mesmo veículo: sobra = km rodado sem registro (dia esquecido); recuo = km inicial menor que o final anterior (erro de digitação).
 */
export const KM_DIA_MAXIMO = 3000;

export interface RegistroDiarioKm {
  id: string;
  veiculoId: string;
  data: string;
  kmInicial: number;
  kmFinal: number;
  consumoLitros: number | null;
}

export interface DiarioKmCalculado extends RegistroDiarioKm {
  kmRodado: number;
  kml: number | null;
  /** km entre o final do registro anterior e o inicial deste (0 = bate). Positivo: km sem registro; negativo: recuo. */
  diferencaAnterior: number | null;
}

const arred = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;

/** Calcula km rodado, km/l e a diferença com o registro anterior de cada veículo (por data). */
export function calcularDiarioKm<T extends RegistroDiarioKm>(registros: readonly T[]): Array<T & Omit<DiarioKmCalculado, keyof RegistroDiarioKm>> {
  const ordem = [...registros].sort((a, b) => a.veiculoId.localeCompare(b.veiculoId) || a.data.localeCompare(b.data) || a.kmInicial - b.kmInicial);
  const anterior = new Map<string, number>();
  const calc = new Map<string, { kmRodado: number; kml: number | null; diferencaAnterior: number | null }>();
  for (const r of ordem) {
    const kmRodado = r.kmFinal - r.kmInicial;
    const prev = anterior.get(r.veiculoId);
    calc.set(r.id, {
      kmRodado,
      kml: r.consumoLitros && r.consumoLitros > 0 && kmRodado > 0 ? arred(kmRodado / r.consumoLitros) : null,
      diferencaAnterior: prev === undefined ? null : r.kmInicial - prev,
    });
    anterior.set(r.veiculoId, r.kmFinal);
  }
  return registros.map((r) => ({ ...r, ...calc.get(r.id)! }));
}

export interface ResumoDiarioKm {
  veiculoId: string;
  dias: number;
  kmRodado: number;
  litros: number;
  /** km/l só dos dias com consumo informado. */
  mediaKml: number | null;
}

export function resumirDiarioKm(itens: ReadonlyArray<Pick<DiarioKmCalculado, "veiculoId" | "kmRodado" | "consumoLitros">>): ResumoDiarioKm[] {
  const m = new Map<string, { dias: number; kmRodado: number; litros: number; kmComConsumo: number }>();
  for (const i of itens) {
    const x = m.get(i.veiculoId) ?? { dias: 0, kmRodado: 0, litros: 0, kmComConsumo: 0 };
    x.dias++;
    x.kmRodado += i.kmRodado;
    if (i.consumoLitros && i.consumoLitros > 0) { x.litros += i.consumoLitros; x.kmComConsumo += i.kmRodado; }
    m.set(i.veiculoId, x);
  }
  return [...m.entries()].map(([veiculoId, x]) => ({
    veiculoId, dias: x.dias, kmRodado: x.kmRodado, litros: arred(x.litros),
    mediaKml: x.litros > 0 && x.kmComConsumo > 0 ? arred(x.kmComConsumo / x.litros) : null,
  }));
}

/** Valida um registro: devolve a mensagem de erro, ou null se está ok. */
export function validarDiarioKm(r: { kmInicial: number; kmFinal: number; consumoLitros: number | null }): string | null {
  if (!Number.isInteger(r.kmInicial) || !Number.isInteger(r.kmFinal) || r.kmInicial < 0) return "Km inicial e final são números inteiros.";
  if (r.kmFinal < r.kmInicial) return "O km final não pode ser menor que o km inicial.";
  if (r.kmFinal - r.kmInicial > KM_DIA_MAXIMO) return `Mais de ${KM_DIA_MAXIMO.toLocaleString("pt-BR")} km num dia: confira o km inicial e o final.`;
  if (r.consumoLitros != null && (!(r.consumoLitros >= 0) || r.consumoLitros > 2000)) return "Consumo em litros inválido.";
  return null;
}
