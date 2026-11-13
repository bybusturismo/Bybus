import { describe, expect, it } from "vitest";
import { calcularNormais, descreverTempo, iconeDoSimbolo, resumirPrevisaoMet, tempoDaNormal } from "../src/index.js";

/** Série no formato do MET (compact): horas em UTC; 10h UTC = 7h em São Paulo. */
function serie(dia: string, simbolo: (hSp: number) => string, chuva: (hSp: number) => number, temp: (hSp: number) => number) {
  const out = [];
  for (let hSp = 0; hSp < 24; hSp++) {
    const t = new Date(`${dia}T00:00:00-03:00`).getTime() + hSp * 3_600_000;
    out.push({ time: new Date(t).toISOString(), data: { instant: { details: { air_temperature: temp(hSp) } }, next_1_hours: { summary: { symbol_code: simbolo(hSp) }, details: { precipitation_amount: chuva(hSp) } } } });
  }
  return out;
}

describe("previsão do tempo (13/11/2026)", () => {
  it("converte os símbolos do MET em ícones", () => {
    expect(iconeDoSimbolo("clearsky_day")).toBe("SOL");
    expect(iconeDoSimbolo("fair_night")).toBe("SOL_NUVENS");
    expect(iconeDoSimbolo("cloudy")).toBe("NUBLADO");
    expect(iconeDoSimbolo("lightrainshowers_day")).toBe("CHUVA_FRACA");
    expect(iconeDoSimbolo("heavyrain")).toBe("CHUVA");
    expect(iconeDoSimbolo("rainandthunder")).toBe("TEMPESTADE");
    expect(iconeDoSimbolo("fog")).toBe("NEBLINA");
  });

  it("um ícone por dia (fuso de São Paulo), olhando o horário do passeio; chuva de madrugada não estraga o dia", () => {
    const json = { properties: { timeseries: [
      ...serie("2026-11-20", (h) => (h < 6 ? "heavyrain" : "clearsky_day"), (h) => (h < 6 ? 4 : 0), (h) => 18 + (h > 12 ? 8 : 0)),
      ...serie("2026-11-21", () => "rain", (h) => (h >= 9 && h < 15 ? 1.2 : 0), () => 20),
      ...serie("2026-11-22", (h) => (h === 15 ? "rainandthunder" : "partlycloudy_day"), () => 0, () => 25),
    ] } };
    const r = resumirPrevisaoMet(json);
    expect(r.map((d) => [d.data, d.icone])).toEqual([["2026-11-20", "SOL"], ["2026-11-21", "CHUVA"], ["2026-11-22", "TEMPESTADE"]]);
    expect(r[0]).toMatchObject({ tempMin: 18, tempMax: 26, chuvaMm: 24, fonte: "PREVISAO" });
    expect(descreverTempo(r[1]!)).toBe("Previsão: Chuva · 20° a 20° · chuva 7,2 mm (MET Norway)");
  });

  it("média histórica por dia do ano, ignorando dados faltantes (-999)", () => {
    const chuva: Record<string, number> = {}, mx: Record<string, number> = {}, mn: Record<string, number> = {};
    for (let ano = 1991; ano <= 2020; ano++) {
      for (let d = 1; d <= 30; d++) {
        const k = `${ano}11${String(d).padStart(2, "0")}`;
        chuva[k] = d % 2 === 0 ? 5 : 0; // metade dos dias com chuva
        mx[k] = 27; mn[k] = ano === 1991 ? -999 : 19;
      }
    }
    const n = calcularNormais({ properties: { parameter: { PRECTOTCORR: chuva, T2M_MAX: mx, T2M_MIN: mn } } });
    const dia = n.find((x) => x.diaAno === "11-15")!;
    expect(dia).toMatchObject({ probChuva: 53, tempMax: 27, tempMin: 19 }); // janela 08 a 22/11: 8 de 15 dias com chuva
    const t = tempoDaNormal("2027-11-15", dia);
    expect(t).toMatchObject({ fonte: "HISTORICO", icone: "NUBLADO" });
    expect(descreverTempo(t)).toMatch(/^Média histórica para o dia .* 53% de chance de chuva · 19° a 27° \(NASA POWER\)$/);
  });
});
