import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Cliente, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
});
afterAll(async () => fechar());

const logado = async (email: string) => {
  const c = new Cliente(app);
  await c.login(email);
  return c;
};
type R = { grupo: string; titulo: string; detalhe: string | null; para: string };
const buscar = async (c: Cliente, q: string) => {
  const r = await c.req("GET", `/api/busca?q=${encodeURIComponent(q)}`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json().resultados as R[];
};

describe("busca geral do topo (16/11/2026)", () => {
  it("acha reservas, equipe e grupos; respeita permissões e praças; não devolve contato", async () => {
    const sup = await logado("supervisor@bybus.test");
    const fln = (await sup.req("GET", "/api/unidades")).json()[0];
    expect((await sup.req("POST", "/api/grupos", { nome: "Escola Fictícia Busca Azul", estilo: "ESCOLA", status: "CONFIRMADO", unidadeId: fln.id, representanteNome: "Rep Fictícia" })).statusCode).toBe(201);

    const reservas = (await buscar(sup, "DEMO")).filter((r) => r.grupo === "Reservas");
    expect(reservas.length).toBeGreaterThan(0);
    expect(reservas[0]!.para).toMatch(/^\/saidas\/[0-9a-f-]{36}\/reservas\?busca=/);
    expect(JSON.stringify(reservas)).not.toMatch(/\+55|@/);

    const equipe = await buscar(sup, "fictícia ana");
    expect(equipe).toContainEqual(expect.objectContaining({ grupo: "Guias e equipe", titulo: "Guia Fictícia Ana" }));
    expect(await buscar(sup, "Busca Azul")).toContainEqual(expect.objectContaining({ grupo: "Grupos fechados", titulo: "Escola Fictícia Busca Azul" }));

    // Outra praça não vê o grupo de Florianópolis.
    const bc = await logado("supervisor.bc@bybus.test");
    expect((await buscar(bc, "Busca Azul")).some((r) => r.grupo === "Grupos fechados")).toBe(false);
    // O guia não tem acesso a grupos nem ao cadastro da equipe.
    const guia = await logado("guia@bybus.test");
    const doGuia = await buscar(guia, "Fictícia");
    expect(doGuia.some((r) => r.grupo === "Grupos fechados" || r.grupo === "Guias e equipe")).toBe(false);

    expect((await sup.req("GET", "/api/busca?q=a")).statusCode).toBe(400);
    expect((await new Cliente(app).req("GET", "/api/busca?q=DEMO")).statusCode).toBe(401);
  });
});
