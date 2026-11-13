import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { finLancamentos, gruposFechados } from "../src/db/schema.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const comDb = async <T>(f: (db: ReturnType<typeof criarDb>["db"]) => Promise<T>) => {
  const { db, pool } = criarDb(DATABASE_URL);
  try { return await f(db); } finally { await pool.end(); }
};
beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
});
afterAll(async () => fechar());

const grupo = {
  nome: "Escola Fictícia Sol Nascente", estilo: "ESCOLA", status: "CONFIRMADO", dataPasseio: "2027-03-20", horarioInicio: "08:00",
  localInicio: "Terminal fictício", roteiro: "a) Centro histórico\nb) Lagoa\nc) Almoço nos Ingleses", almoco: true, localAlmoco: "Restaurante fictício",
  pessoas: 20, pessoasMinimo: 25, cortesias: 3, valorPorPessoaCentavos: 13000, sinalPercentual: 50,
  razaoSocial: "Escola Fictícia Ltda", cnpj: "00.000.000/0001-00", representanteNome: "Representante Fictícia", representanteCpf: "000.000.000-00", representanteEmail: "rep@exemplo.test",
};

describe("grupos fechados (13/11/2026)", () => {
  it("cadastra com total pelo mínimo, CPF cifrado, cobrança vira contas a receber (uma vez), anexo e histórico", async () => {
    const c = new Cliente(app);
    await c.login("supervisor@bybus.test");
    const r = await c.req("POST", "/api/grupos", grupo);
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as string;
    const [bruto] = await comDb((db) => db.select().from(gruposFechados).where(eq(gruposFechados.id, id)));
    expect(bruto!.valorTotalCentavos).toBe(325000); // 20 pessoas, mínimo 25 × R$ 130
    expect(bruto!.representanteCpfCifrado).not.toContain("00000000000");
    const det = (await c.req("GET", `/api/grupos/${id}`)).json();
    expect(det).toMatchObject({ representanteCpf: "00000000000", roteiro: grupo.roteiro, anteriores: [] });
    expect(det).not.toHaveProperty("representanteCpfCifrado");

    const cob = await c.req("POST", `/api/grupos/${id}/cobranca`, { vencimentoSinal: "2027-02-20" });
    expect(cob.statusCode, cob.body).toBe(200);
    expect((await c.req("POST", `/api/grupos/${id}/cobranca`, {})).statusCode).toBe(409);
    const lancs = await comDb((db) => db.select().from(finLancamentos).where(eq(finLancamentos.grupoFechadoId, id)));
    expect(lancs.map((l) => [l.tipo, l.valorCentavos, l.vencimento, l.origem]).sort()).toEqual([["RECEBER", 162500, "2027-02-20", "GRUPO"], ["RECEBER", 162500, "2027-03-20", "GRUPO"]]);
    // Sinal recebido no financeiro aparece no grupo.
    await comDb((db) => db.update(finLancamentos).set({ situacao: "REALIZADO", pagoEm: "2027-02-19", valorPagoCentavos: 162500 }).where(eq(finLancamentos.vencimento, "2027-02-20")));
    const lista = (await c.req("GET", "/api/grupos?q=Sol Nascente")).json();
    expect(lista[0]).toMatchObject({ cobradoCentavos: 325000, recebidoCentavos: 162500 });

    const pdf = Buffer.from("%PDF-1.4\n%contrato fictício\n").toString("base64");
    expect((await c.req("POST", `/api/grupos/${id}/anexos`, { tipo: "CONTRATO", nome: "contrato.pdf", base64: pdf })).statusCode).toBe(201);
    expect((await c.req("GET", `/api/grupos/${id}`)).json().anexos[0]).toMatchObject({ tipo: "CONTRATO", nomeArquivo: "contrato.pdf" });

    // Mesmo grupo no ano seguinte: o histórico mostra o valor cobrado antes.
    const novo = await c.req("POST", "/api/grupos", { ...grupo, dataPasseio: "2028-03-18", status: "ORCAMENTO" });
    const ant = (await c.req("GET", `/api/grupos/${novo.json().id}`)).json().anteriores;
    expect(ant[0]).toMatchObject({ dataPasseio: "2027-03-20", valorPorPessoaCentavos: 13000, valorTotalCentavos: 325000 });
  });

  it("quem não lança reservas não acessa", async () => {
    const g = new Cliente(app);
    await g.login("guia@bybus.test");
    expect((await g.req("GET", "/api/grupos")).statusCode).toBe(403);
  });
});
