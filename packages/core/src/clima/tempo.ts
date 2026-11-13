/**
 * Previsão do tempo nos dias de passeio (pedido do dono, 13/11/2026: "solução definitiva", como na TOMA).
 * - Próximos ~9 dias: previsão do MET Norway (gratuita, uso comercial permitido com atribuição).
 * - Datas mais distantes: média histórica daquele dia do ano (NASA POWER, 1991–2020), marcada como "média histórica".
 *   Nenhum serviço prevê com confiança além de ~2 semanas; a média mostra o que costuma acontecer.
 * Regras puras: conversão dos dados dos serviços para um ícone por dia, no fuso de São Paulo.
 */

export const ICONES_TEMPO = ["SOL", "SOL_NUVENS", "NUBLADO", "NEBLINA", "CHUVA_FRACA", "CHUVA", "TEMPESTADE"] as const;
export type IconeTempo = (typeof ICONES_TEMPO)[number];
export type FonteTempo = "PREVISAO" | "HISTORICO";

export interface TempoDia {
  data: string; // YYYY-MM-DD (São Paulo)
  fonte: FonteTempo;
  icone: IconeTempo;
  tempMin: number | null;
  tempMax: number | null;
  chuvaMm: number | null;
  /** Chance de chuva em % (só na média histórica: dias com ≥ 1 mm). */
  probChuva: number | null;
}

export const ROTULO_ICONE_TEMPO: Record<IconeTempo, string> = {
  SOL: "Ensolarado", SOL_NUVENS: "Sol entre nuvens", NUBLADO: "Nublado", NEBLINA: "Neblina",
  CHUVA_FRACA: "Chuva fraca", CHUVA: "Chuva", TEMPESTADE: "Chuva com trovoadas",
};

/** Código de símbolo do MET Norway (ex.: "partlycloudy_day", "lightrainshowers_night") → ícone. */
export function iconeDoSimbolo(codigo: string): IconeTempo {
  const c = codigo.replace(/_(day|night|polartwilight)$/, "");
  if (c.includes("thunder")) return "TEMPESTADE";
  if (c.startsWith("heavyrain") || c === "rain" || c === "rainshowers" || c.includes("sleet") || c.includes("snow")) return "CHUVA";
  if (c.startsWith("light") && c.includes("rain")) return "CHUVA_FRACA";
  if (c === "fog") return "NEBLINA";
  if (c === "cloudy") return "NUBLADO";
  if (c === "partlycloudy" || c === "fair") return "SOL_NUVENS";
  if (c === "clearsky") return "SOL";
  return "NUBLADO";
}

interface SerieMet {
  time: string;
  data?: {
    instant?: { details?: { air_temperature?: number } };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
  };
}

const diaSp = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
const horaSp = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
const arred = (n: number) => Math.round(n * 10) / 10;

/**
 * Resume a previsão horária/6 h do MET (locationforecast/2.0 compact) em um ícone por dia. O ícone olha o período do passeio
 * (7h às 19h): trovoada em qualquer hora → tempestade; chuva somada ≥ 5 mm → chuva; ≥ 0,5 mm → chuva fraca; senão o céu mais
 * frequente. Dias com poucas horas de dados (o fim da previsão) não entram.
 */
export function resumirPrevisaoMet(json: unknown): TempoDia[] {
  const serie = ((json as { properties?: { timeseries?: SerieMet[] } })?.properties?.timeseries ?? []).filter((s) => typeof s?.time === "string");
  const porDia = new Map<string, { temps: number[]; chuvaDia: number; chuvaTotal: number; ceus: IconeTempo[]; trovoada: boolean; horasDia: number }>();
  for (let i = 0; i < serie.length; i++) {
    const s = serie[i]!;
    const dia = diaSp(s.time);
    const h = horaSp(s.time);
    const d = porDia.get(dia) ?? { temps: [], chuvaDia: 0, chuvaTotal: 0, ceus: [], trovoada: false, horasDia: 0 };
    porDia.set(dia, d);
    const t = s.data?.instant?.details?.air_temperature;
    if (typeof t === "number") d.temps.push(t);
    // Chuva: pelo bloco de 1 h quando existe; no fim da série só há blocos de 6 h (sem somar em dobro).
    const um = s.data?.next_1_hours;
    const seis = s.data?.next_6_hours;
    const proximo = serie[i + 1] ? new Date(serie[i + 1]!.time).getTime() - new Date(s.time).getTime() : 0;
    const bloco = um ?? (proximo >= 6 * 3_600_000 || !serie[i + 1] ? seis : undefined);
    const horas = um ? 1 : bloco ? 6 : 0;
    const mm = bloco?.details?.precipitation_amount ?? 0;
    const simbolo = bloco?.summary?.symbol_code;
    d.chuvaTotal += mm;
    const noPasseio = h >= 7 && h < 19;
    if (noPasseio && simbolo) {
      d.chuvaDia += mm;
      d.horasDia += horas;
      const ic = iconeDoSimbolo(simbolo);
      if (ic === "TEMPESTADE") d.trovoada = true;
      for (let k = 0; k < horas; k++) d.ceus.push(ic);
    }
  }
  const saida: TempoDia[] = [];
  for (const [data, d] of porDia) {
    if (d.horasDia < 6) continue;
    let icone: IconeTempo;
    if (d.trovoada) icone = "TEMPESTADE";
    else if (d.chuvaDia >= 5) icone = "CHUVA";
    else if (d.chuvaDia >= 0.5) icone = "CHUVA_FRACA";
    else {
      const ceus = d.ceus.filter((c) => c === "SOL" || c === "SOL_NUVENS" || c === "NUBLADO" || c === "NEBLINA");
      const conta = (c: IconeTempo) => ceus.filter((x) => x === c).length;
      icone = (["NUBLADO", "SOL_NUVENS", "SOL", "NEBLINA"] as const).reduce<IconeTempo>((a, c) => (conta(c) > conta(a) ? c : a), "SOL_NUVENS");
    }
    saida.push({
      data, fonte: "PREVISAO", icone,
      tempMin: d.temps.length ? Math.round(Math.min(...d.temps)) : null,
      tempMax: d.temps.length ? Math.round(Math.max(...d.temps)) : null,
      chuvaMm: arred(d.chuvaTotal), probChuva: null,
    });
  }
  return saida.sort((a, b) => a.data.localeCompare(b.data));
}

export interface NormalDia { diaAno: string; probChuva: number; tempMin: number; tempMax: number; chuvaMm: number }

/**
 * Médias históricas por dia do ano ("MM-DD") a partir da série diária da NASA POWER (PRECTOTCORR, T2M_MAX, T2M_MIN).
 * Cada dia usa uma janela de ±7 dias em todos os anos (suaviza). Valores -999 (falta de dado) são ignorados.
 */
export function calcularNormais(json: unknown): NormalDia[] {
  const p = (json as { properties?: { parameter?: Record<string, Record<string, number>> } })?.properties?.parameter ?? {};
  const chuva = p.PRECTOTCORR ?? {};
  const tmax = p.T2M_MAX ?? {};
  const tmin = p.T2M_MIN ?? {};
  // Agrupa por posição no ano (1..366, com 29/02 junto de 28/02 para não ficar com poucos dados).
  const porDia = new Map<string, Array<{ c: number; mx: number; mn: number }>>();
  for (const k of Object.keys(chuva)) {
    if (!/^\d{8}$/.test(k)) continue;
    const c = chuva[k]!, mx = tmax[k], mn = tmin[k];
    if (c < 0 || mx === undefined || mn === undefined || mx <= -900 || mn <= -900) continue;
    const md = `${k.slice(4, 6)}-${k.slice(6, 8)}`;
    porDia.set(md, [...(porDia.get(md) ?? []), { c, mx, mn }]);
  }
  const dias: string[] = [];
  for (let d = new Date(Date.UTC(2024, 0, 1)); d.getUTCFullYear() === 2024; d = new Date(d.getTime() + 86_400_000)) dias.push(d.toISOString().slice(5, 10));
  const saida: NormalDia[] = [];
  for (let i = 0; i < dias.length; i++) {
    const amostra: Array<{ c: number; mx: number; mn: number }> = [];
    for (let j = -7; j <= 7; j++) amostra.push(...(porDia.get(dias[(i + j + dias.length) % dias.length]!) ?? []));
    if (amostra.length < 30) continue;
    const media = (f: (x: { c: number; mx: number; mn: number }) => number) => amostra.reduce((a, x) => a + f(x), 0) / amostra.length;
    saida.push({
      diaAno: dias[i]!,
      probChuva: Math.round((amostra.filter((x) => x.c >= 1).length / amostra.length) * 100),
      tempMin: Math.round(media((x) => x.mn)), tempMax: Math.round(media((x) => x.mx)), chuvaMm: arred(media((x) => x.c)),
    });
  }
  return saida;
}

/** Ícone da média histórica: chance de chuva alta → chuva; média → nuvens; baixa → sol. */
export function tempoDaNormal(data: string, n: NormalDia): TempoDia {
  const icone: IconeTempo = n.probChuva >= 55 ? "CHUVA" : n.probChuva >= 40 ? "NUBLADO" : n.probChuva >= 25 ? "SOL_NUVENS" : "SOL";
  return { data, fonte: "HISTORICO", icone, tempMin: n.tempMin, tempMax: n.tempMax, chuvaMm: n.chuvaMm, probChuva: n.probChuva };
}

/** Texto curto para a dica do ícone. */
export function descreverTempo(t: TempoDia): string {
  const temp = t.tempMin !== null && t.tempMax !== null ? ` · ${t.tempMin}° a ${t.tempMax}°` : "";
  // Crédito exigido pelas licenças (CC BY 4.0 do MET Norway; NASA POWER pede citação).
  if (t.fonte === "HISTORICO") return `Média histórica para o dia (ainda sem previsão): ${t.probChuva ?? "?"}% de chance de chuva${temp} (NASA POWER)`;
  const chuva = t.chuvaMm ? ` · chuva ${String(t.chuvaMm).replace(".", ",")} mm` : "";
  return `Previsão: ${ROTULO_ICONE_TEMPO[t.icone]}${temp}${chuva} (MET Norway)`;
}
