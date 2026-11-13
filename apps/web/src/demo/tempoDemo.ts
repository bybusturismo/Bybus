import type { IconeTempo, TempoDia } from "@bybus/core";
import { NAO, type Rotear } from "./comum";

/** Previsão do tempo FICTÍCIA da demonstração (sem consultar nenhum serviço). */
const CICLO: IconeTempo[] = ["SOL", "SOL_NUVENS", "SOL", "NUBLADO", "CHUVA_FRACA", "SOL_NUVENS", "CHUVA", "SOL", "TEMPESTADE"];
const somar = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

export const rotearTempo: Rotear = (ctx, metodo, caminho, q) => {
  if (metodo !== "GET" || caminho !== "/api/tempo") return NAO;
  const de = q.get("de") ?? ctx.dataMais(0);
  const ate = q.get("ate") ?? de;
  const hoje = ctx.dataMais(0);
  const dias: TempoDia[] = [];
  for (let d = de, i = 0; d <= ate && i < 400; d = somar(d, 1), i++) {
    const n = Math.round((new Date(`${d}T12:00:00Z`).getTime() - new Date(`${hoje}T12:00:00Z`).getTime()) / 86_400_000);
    if (n < -30) continue;
    const icone = CICLO[((n % CICLO.length) + CICLO.length) % CICLO.length]!;
    dias.push(n <= 9
      ? { data: d, fonte: "PREVISAO", icone, tempMin: 19 + (n % 3), tempMax: 26 + (n % 4), chuvaMm: icone.startsWith("CHUVA") || icone === "TEMPESTADE" ? 8 : 0, probChuva: null }
      : { data: d, fonte: "HISTORICO", icone: n % 3 === 0 ? "NUBLADO" : "SOL_NUVENS", tempMin: 20, tempMax: 28, chuvaMm: 5, probChuva: n % 3 === 0 ? 45 : 32 });
  }
  return { porPraca: { "un-fln": dias, "un-bc": dias }, creditos: "Demonstração (dados fictícios)" };
};
