import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { tempoNormais, tempoPrevisoes, unidades } from "../src/db/schema.js";
import { atualizarTempo } from "../src/servicos/tempo.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const comDb = async <T>(f: (db: ReturnType<typeof criarDb>["db"]) => Promise<T>) => {
  const { db, pool } = criarDb(DATABASE_URL);
  try { return await f(db); } finally { await pool.end(); }
};
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const somar = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** MET simulado: 3 dias a partir de amanhã, de hora em hora (o segundo com chuva no meio do dia). */
function met() {
  const serie = [];
  for (let dia = 1; dia <= 3; dia++) {
    for (let h = 0; h < 24; h++) {
      const t = new Date(`${somar(hoje(), dia)}T00:00:00-03:00`).getTime() + h * 3_600_000;
      const chuva = dia === 2 && h >= 10 && h < 16;
      serie.push({ time: new Date(t).toISOString(), data: { instant: { details: { air_temperature: 20 + (h > 12 ? 6 : 0) } }, next_1_hours: { summary: { symbol_code: chuva ? "rain" : "clearsky_day" }, details: { precipitation_amount: chuva ? 2 : 0 } } } });
    }
  }
  return { properties: { timeseries: serie } };
}
/** NASA simulada: 30 anos, chove em 1 de cada 4 dias. */
function nasa() {
  const c: Record<string, number> = {}, mx: Record<string, number> = {}, mn: Record<string, number> = {};
  for (let ano = 1991; ano <= 2020; ano++) {
    for (let d = new Date(Date.UTC(ano, 0, 1)); d.getUTCFullYear() === ano; d = new Date(d.getTime() + 86_400_000)) {
      const k = d.toISOString().slice(0, 10).replaceAll("-", "");
      c[k] = d.getUTCDate() % 4 === 0 ? 8 : 0; mx[k] = 28; mn[k] = 19;
    }
  }
  return { properties: { parameter: { PRECTOTCORR: c, T2M_MAX: mx, T2M_MIN: mn } } };
}

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  // A migração já grava o centro das praças; aqui só Florianópolis fica com coordenadas (testes mais simples).
  await comDb(async (db) => {
    await db.update(unidades).set({ latitude: null, longitude: null });
    await db.update(unidades).set({ latitude: -27.5954, longitude: -48.548 }).where(eq(unidades.codigo, "FLN"));
  });
});
afterAll(async () => fechar());

describe("previsão do tempo (13/11/2026)", () => {
  it("busca a previsão (MET) e a média histórica (NASA) só com as coordenadas da praça, identificando o sistema", async () => {
    const pedidos: Array<{ url: string; ua: string | null }> = [];
    const buscar = (async (url: string, init?: RequestInit) => {
      pedidos.push({ url, ua: new Headers(init?.headers).get("User-Agent") });
      return new Response(JSON.stringify(url.includes("api.met.no") ? met() : nasa()), { status: 200 });
    }) as typeof fetch;
    const r = await comDb((db) => atualizarTempo(db, buscar));
    expect(r.falhas).toEqual([]);
    expect(r.previsoes).toBe(3);
    expect(r.normais).toBeGreaterThan(360);
    expect(pedidos.every((p) => p.ua?.startsWith("BybusGestao/1.0"))).toBe(true);
    expect(pedidos.map((p) => new URL(p.url).host).sort()).toEqual(["api.met.no", "power.larc.nasa.gov"]);
    // Segunda vez: a média histórica não é baixada de novo; a previsão é atualizada (sem duplicar).
    pedidos.length = 0;
    await comDb((db) => atualizarTempo(db, buscar));
    expect(pedidos.map((p) => new URL(p.url).host)).toEqual(["api.met.no"]);
    expect((await comDb((db) => db.select().from(tempoPrevisoes))).length).toBe(3);
  });

  it("devolve previsão nos próximos dias e média histórica depois; exige login", async () => {
    expect((await new Cliente(app).req("GET", `/api/tempo?de=${hoje()}&ate=${somar(hoje(), 3)}`)).statusCode).toBe(401);
    const c = new Cliente(app);
    await c.login("supervisor@bybus.test");
    const res = await c.req("GET", `/api/tempo?de=${somar(hoje(), 1)}&ate=${somar(hoje(), 30)}`);
    expect(res.statusCode, res.body).toBe(200);
    const [fln] = await comDb((db) => db.select().from(unidades).where(eq(unidades.codigo, "FLN")));
    const dias = res.json().porPraca[fln!.id] as Array<{ data: string; fonte: string; icone: string; probChuva: number | null }>;
    expect(dias).toHaveLength(30);
    expect(dias.slice(0, 3).map((d) => [d.fonte, d.icone])).toEqual([["PREVISAO", "SOL"], ["PREVISAO", "CHUVA"], ["PREVISAO", "SOL"]]);
    // Chove em ~1 de cada 4 dias (20% a 27% conforme a janela do dia): sol ou sol entre nuvens.
    expect(dias[10]).toMatchObject({ fonte: "HISTORICO" });
    expect(["SOL", "SOL_NUVENS"]).toContain(dias[10]!.icone);
    expect(dias[10]!.probChuva).toBeGreaterThanOrEqual(13);
    expect(dias[10]!.probChuva).toBeLessThanOrEqual(34);
  });

  it("falha do serviço não apaga o que já existe", async () => {
    const r = await comDb((db) => atualizarTempo(db, (async () => new Response("erro", { status: 503 })) as unknown as typeof fetch));
    expect(r.falhas[0]).toMatch(/FLN: previsão \(MET respondeu 503\)/);
    expect((await comDb((db) => db.select().from(tempoPrevisoes))).length).toBe(3);
    expect((await comDb((db) => db.select().from(tempoNormais))).length).toBeGreaterThan(360);
  });
});
