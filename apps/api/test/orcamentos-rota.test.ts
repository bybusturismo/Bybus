import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { Cliente, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
let semChave: { app: FastifyInstance; fechar: () => Promise<void> };
beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ ORS_CHAVE: "chave-ficticia" }));
  semChave = await subirApp();
});
afterAll(async () => { await fechar(); await semChave.fechar(); });
afterEach(() => vi.unstubAllGlobals());

const pontos = [
  { nome: "Ponto fictício A", lat: -27.5954, lng: -48.548, permanenciaMin: 0 },
  { nome: "Ponto fictício B", lat: -27.6, lng: -48.47, permanenciaMin: 60 },
  { nome: "Ponto fictício C", lat: -27.44, lng: -48.5, permanenciaMin: 90 },
];
const tabela = {
  VAN: { valorKmCentavos: 500, valorHoraCentavos: 8000, horasMinimas: 4, minimoCentavos: 60000 },
  MICRO: { valorKmCentavos: 700, valorHoraCentavos: 10000, horasMinimas: 4, minimoCentavos: 80000 },
  ONIBUS: { valorKmCentavos: 900, valorHoraCentavos: 12000, horasMinimas: 5, minimoCentavos: 100000 },
};

describe("orçamento com rota (13/11/2026)", () => {
  it("tabela só pelo financeiro; rota pelo OpenRouteService (perfil pesado no ônibus); número, PDF e virar grupo", async () => {
    const atendente = new Cliente(app);
    await atendente.login("atendente@bybus.test");
    expect((await atendente.req("PUT", "/api/orcamentos-rota/tabela", tabela)).statusCode).toBe(403);
    const admin = new Cliente(app);
    await admin.login("admin@bybus.test");
    expect((await admin.req("PUT", "/api/orcamentos-rota/tabela", tabela)).statusCode).toBe(200);

    const chamadas: Array<{ url: string; corpo: unknown; auth: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ routes: [{ summary: { distance: 40000, duration: 3600 }, segments: [{ distance: 15000, duration: 1500 }, { distance: 25000, duration: 2100 }] }] }), { status: 200 });
    }));
    const calc = await admin.req("POST", "/api/orcamentos-rota/calcular", { pontos, veiculo: "ONIBUS", folgaMin: 30 });
    expect(calc.statusCode, calc.body).toBe(200);
    expect(chamadas[0]!.url).toContain("/v2/directions/driving-hgv");
    expect(chamadas[0]!.auth).toBe("chave-ficticia");
    expect(chamadas[0]!.corpo).toEqual({ coordinates: pontos.map((p) => [p.lng, p.lat]) });
    const j = calc.json();
    expect(j).toMatchObject({ fonte: "OPENROUTESERVICE", distanciaKm: 40, duracaoMin: 60 });
    expect(j.cargaHorariaMin).toBe(60 + 60 + 90 + 30);
    // 40 km × R$ 9 = 360 + 5 h mínimas × R$ 120 = 600 → R$ 960, abaixo do mínimo de R$ 1.000.
    expect(j.preco.totalCentavos).toBe(100000);

    const cria = await admin.req("POST", "/api/orcamentos-rota", { cliente: "Escola Fictícia", contato: "Contato fictício", dataPasseio: "2027-04-10", horarioInicio: "08:00", veiculo: "ONIBUS", pessoas: 40, pontos, valorFinalCentavos: 120000 });
    expect(cria.statusCode, cria.body).toBe(201);
    const { id, numero } = cria.json();
    expect(numero).toMatch(/^\d{4}-\d{4}$/);
    const outro = await admin.req("POST", "/api/orcamentos-rota", { cliente: "Outro Fictício", veiculo: "VAN", pontos: pontos.slice(0, 2) });
    expect(Number(outro.json().numero.slice(5))).toBe(Number(numero.slice(5)) + 1);
    expect(chamadas.at(-1)!.url).toContain("driving-car");

    const det = (await admin.req("GET", `/api/orcamentos-rota/${id}`)).json();
    expect(det).toMatchObject({ distanciaKm: 40, valorCalculadoCentavos: 100000, valorFinalCentavos: 120000, cargaHorariaMin: 240 });

    const pdf = await admin.req("GET", `/api/orcamentos-rota/${id}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe("%PDF");

    const g = await admin.req("POST", `/api/orcamentos-rota/${id}/grupo`);
    expect(g.statusCode, g.body).toBe(200);
    const grupo = (await admin.req("GET", `/api/grupos/${g.json().grupoId}`)).json();
    expect(grupo).toMatchObject({ nome: "Escola Fictícia", dataPasseio: "2027-04-10", pessoas: 40, valorTotalCentavos: 120000, valorPorPessoaCentavos: 3000, localInicio: "Ponto fictício A" });
    expect((await admin.req("POST", `/api/orcamentos-rota/${id}/grupo`)).json()).toMatchObject({ grupoId: g.json().grupoId, existente: true });

    const guia = new Cliente(app);
    await guia.login("guia@bybus.test");
    expect((await guia.req("GET", "/api/orcamentos-rota")).statusCode).toBe(403);
  });

  it("sem chave: estimativa pela linha reta e nenhuma chamada ao OpenRouteService", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const c = new Cliente(semChave.app);
    await c.login("admin@bybus.test");
    const r = await c.req("POST", "/api/orcamentos-rota/calcular", { pontos, veiculo: "VAN" });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().fonte).toBe("ESTIMATIVA");
    expect(r.json().distanciaKm).toBeGreaterThan(20);
    expect(f).not.toHaveBeenCalled();
  });
});
