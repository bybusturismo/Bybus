import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { calcularNormais, resumirPrevisaoMet, tempoDaNormal, type IconeTempo, type TempoDia } from "@bybus/core";
import type { Config } from "../config.js";
import type { Db } from "../db/cliente.js";
import { tempoNormais, tempoPrevisoes, unidades } from "../db/schema.js";

/**
 * Previsão do tempo por praça (13/11/2026). Fontes gratuitas, sem chave e que permitem uso comercial:
 * - MET Norway (api.met.no, CC BY 4.0): previsão dos próximos ~9 dias. Exige um User-Agent que identifique o sistema.
 * - NASA POWER: série diária 1991–2020, baixada UMA vez por praça para calcular a média histórica de cada dia do ano.
 * Só as coordenadas do centro da cidade saem do sistema (nenhum dado de cliente).
 */
const AGENTE = "BybusGestao/1.0 (+https://gestao.bybusturismo.com.br)";
const URL_MET = (lat: number, lon: number) => `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
const URL_NASA = (lat: number, lon: number) =>
  `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M_MAX,T2M_MIN&community=RE&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start=19910101&end=20201231&format=JSON`;

type Log = { error: (o: unknown, m: string) => void; info: (o: unknown, m: string) => void };

export async function atualizarTempo(db: Db, buscar: typeof fetch = fetch) {
  const pracas = await db.select().from(unidades).where(and(eq(unidades.ativa, true), isNotNull(unidades.latitude), isNotNull(unidades.longitude)));
  const r = { previsoes: 0, normais: 0, falhas: [] as string[] };
  for (const u of pracas) {
    const lat = u.latitude!, lon = u.longitude!;
    try {
      const resp = await buscar(URL_MET(lat, lon), { headers: { "User-Agent": AGENTE, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!resp.ok) throw new Error(`MET respondeu ${resp.status}`);
      const dias = resumirPrevisaoMet(await resp.json());
      for (const d of dias) {
        const v = { icone: d.icone, tempMin: d.tempMin, tempMax: d.tempMax, chuvaMm: d.chuvaMm, atualizadoEm: new Date() };
        await db.insert(tempoPrevisoes).values({ unidadeId: u.id, data: d.data, ...v }).onConflictDoUpdate({ target: [tempoPrevisoes.unidadeId, tempoPrevisoes.data], set: v });
      }
      r.previsoes += dias.length;
    } catch (e) {
      r.falhas.push(`${u.codigo}: previsão (${e instanceof Error ? e.message : String(e)})`);
    }
    // Média histórica: só na primeira vez (não muda).
    const [ja] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(tempoNormais).where(eq(tempoNormais.unidadeId, u.id));
    if ((ja?.n ?? 0) > 300) continue;
    try {
      const resp = await buscar(URL_NASA(lat, lon), { headers: { "User-Agent": AGENTE }, signal: AbortSignal.timeout(90_000) });
      if (!resp.ok) throw new Error(`NASA respondeu ${resp.status}`);
      const normais = calcularNormais(await resp.json());
      if (normais.length < 300) throw new Error("série histórica incompleta");
      await db.transaction(async (tx) => {
        await tx.delete(tempoNormais).where(eq(tempoNormais.unidadeId, u.id));
        await tx.insert(tempoNormais).values(normais.map((n) => ({ unidadeId: u.id, ...n })));
      });
      r.normais += normais.length;
    } catch (e) {
      r.falhas.push(`${u.codigo}: média histórica (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return r;
}

/** Tempo de cada dia no período, por praça: previsão gravada; sem previsão e no futuro, a média histórica. */
export async function tempoDoPeriodo(db: Db, unidadeIds: string[] | null, de: string, ate: string, hoje: string) {
  const filtroU = (c: typeof tempoPrevisoes.unidadeId | typeof tempoNormais.unidadeId) => (unidadeIds ? inArray(c, unidadeIds.length ? unidadeIds : ["00000000-0000-0000-0000-000000000000"]) : undefined);
  const prev = await db.select().from(tempoPrevisoes).where(and(filtroU(tempoPrevisoes.unidadeId), gte(tempoPrevisoes.data, de), lte(tempoPrevisoes.data, ate)));
  const normais = await db.select().from(tempoNormais).where(filtroU(tempoNormais.unidadeId));
  const porUnidade = new Map<string, TempoDia[]>();
  const add = (u: string, t: TempoDia) => porUnidade.set(u, [...(porUnidade.get(u) ?? []), t]);
  const temPrev = new Set(prev.map((p) => `${p.unidadeId}|${p.data}`));
  for (const p of prev) add(p.unidadeId, { data: p.data, fonte: "PREVISAO", icone: p.icone as IconeTempo, tempMin: p.tempMin, tempMax: p.tempMax, chuvaMm: p.chuvaMm, probChuva: null });
  const normal = new Map(normais.map((n) => [`${n.unidadeId}|${n.diaAno}`, n]));
  const unidadesComNormal = [...new Set(normais.map((n) => n.unidadeId))];
  for (let d = de > hoje ? de : hoje; d <= ate; d = somarDia(d)) {
    for (const u of unidadesComNormal) {
      if (temPrev.has(`${u}|${d}`)) continue;
      const n = normal.get(`${u}|${d.slice(5)}`) ?? (d.slice(5) === "02-29" ? normal.get(`${u}|02-28`) : undefined);
      if (n) add(u, tempoDaNormal(d, n));
    }
  }
  return Object.fromEntries([...porUnidade].map(([u, l]) => [u, l.sort((a, b) => a.data.localeCompare(b.data))]));
}

const somarDia = (d: string) => new Date(new Date(`${d}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/** A cada 3 horas (o MET pede para não consultar com frequência maior do que a atualização do modelo). */
export function agendarTempo(db: Db, config: Config, log: Log): () => void {
  if (config.AMBIENTE === "testes") return () => {};
  const rodar = () => atualizarTempo(db).then((r) => { if (r.falhas.length) log.error({ falhas: r.falhas }, "Previsão do tempo com falhas"); else log.info(r, "Previsão do tempo atualizada"); })
    .catch((e) => log.error({ erro: e instanceof Error ? e.message : e }, "Falha na previsão do tempo"));
  const inicio = setTimeout(rodar, 60_000);
  const intervalo = setInterval(rodar, 3 * 3_600_000);
  return () => { clearTimeout(inicio); clearInterval(intervalo); };
}
