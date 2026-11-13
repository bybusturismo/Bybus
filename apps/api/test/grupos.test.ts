import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { finLancamentos, gruposFechados, gruposPassageiros } from "../src/db/schema.js";
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

  it("lista de passageiros: equipe salva; link do representante preenche (com aceite); documento cifrado; fecha após o passeio", async () => {
    const c = new Cliente(app);
    await c.login("supervisor@bybus.test");
    const id = (await c.req("POST", "/api/grupos", { ...grupo, nome: "Escola Fictícia Lista", dataPasseio: "2099-05-10" })).json().id as string;
    const ruim = await c.req("PUT", `/api/grupos/${id}/passageiros`, { passageiros: [{ nome: "Aluno Fictício", documento: "111.111.111-11" }] });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().mensagem).toMatch(/linha 1: CPF inválido/);
    expect((await c.req("PUT", `/api/grupos/${id}/passageiros`, { passageiros: [{ nome: "Aluno Fictício", documento: "529.982.247-25", nascimento: "10/05/2014" }, { nome: "", documento: "" }] })).json()).toEqual({ quantidade: 1 });
    const [bruto] = await comDb((db) => db.select().from(gruposPassageiros).where(eq(gruposPassageiros.grupoId, id)));
    expect(bruto!.documentoCifrado).not.toContain("52998224725");

    const link = await c.req("POST", `/api/grupos/${id}/link-lista`, { dias: 15 });
    const tok = String(link.json().caminho).split("/").pop()!;
    const pub = new Cliente(app);
    const ver = (await pub.req("GET", `/api/publico/lista-grupo/${tok}`)).json();
    expect(ver).toMatchObject({ grupo: { nome: "Escola Fictícia Lista" }, aberta: true, passageiros: [{ nome: "Aluno Fictício", documento: "52998224725", tipoDocumento: "CPF", categoria: "ALUNO" }] });
    expect(JSON.stringify(ver)).not.toMatch(/valor|cnpj|representante/i);
    expect((await pub.req("PUT", `/api/publico/lista-grupo/${tok}`, { passageiros: [{ nome: "Professora Fictícia", categoria: "PROFESSOR" }] })).statusCode).toBe(400); // sem aceite
    const env = await pub.req("PUT", `/api/publico/lista-grupo/${tok}`, { aceite: true, passageiros: [{ nome: "Aluno Fictício", documento: "529.982.247-25" }, { nome: "Professora Fictícia", categoria: "PROFESSOR" }] });
    expect(env.json()).toEqual({ quantidade: 2 });
    const equipe = (await c.req("GET", `/api/grupos/${id}/passageiros`)).json();
    expect(equipe).toMatchObject({ totais: { ALUNO: 1, PROFESSOR: 1 }, link: { ativo: true } });
    expect(equipe.passageiros[1]).toMatchObject({ nome: "Professora Fictícia", origem: "REPRESENTANTE" });
    // Passeio já realizado: lista fechada para o representante.
    await comDb((db) => db.update(gruposFechados).set({ dataPasseio: "2020-01-01" }).where(eq(gruposFechados.id, id)));
    expect((await pub.req("PUT", `/api/publico/lista-grupo/${tok}`, { aceite: true, passageiros: [] })).statusCode).toBe(409);
    // Cancelar o link derruba o acesso.
    await c.req("DELETE", `/api/grupos/${id}/link-lista`);
    expect((await pub.req("GET", `/api/publico/lista-grupo/${tok}`)).statusCode).toBe(404);
  });

  it("contrato e recibo em PDF no timbrado; dados da empresa só o administrador muda", async () => {
    const c = new Cliente(app);
    await c.login("supervisor@bybus.test");
    const id = (await c.req("POST", "/api/grupos", { ...grupo, nome: "Escola Fictícia Contrato" })).json().id as string;
    await c.req("POST", `/api/grupos/${id}/cobranca`, { vencimentoSinal: "2027-02-20" });
    const pdf = await c.req("GET", `/api/grupos/${id}/contrato.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.rawPayload.length).toBeGreaterThan(30_000); // com o timbrado ao fundo
    if (process.env.SALVAR_PDF) (await import("node:fs")).writeFileSync(process.env.SALVAR_PDF, pdf.rawPayload);
    const [l] = await comDb((db) => db.select().from(finLancamentos).where(eq(finLancamentos.grupoFechadoId, id)));
    expect((await c.req("GET", `/api/grupos/${id}/recibo/${l!.id}`)).statusCode).toBe(409); // ainda não pago
    await comDb((db) => db.update(finLancamentos).set({ situacao: "REALIZADO", pagoEm: "2027-02-19", valorPagoCentavos: l!.valorCentavos }).where(eq(finLancamentos.id, l!.id)));
    const rec = await c.req("GET", `/api/grupos/${id}/recibo/${l!.id}`);
    expect(rec.statusCode).toBe(200);
    expect(rec.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    // Dados da empresa: supervisor lê, só administrador altera.
    expect((await c.req("GET", "/api/configuracoes/contrato")).json()).toMatchObject({ cnpj: "09.529.650/0001-01", cidadeForo: "Florianópolis/SC", assinanteNome: null });
    const dados = { razaoSocial: "By Bus Turismo Ltda.", cnpj: "09.529.650/0001-01", endereco: "Endereço fictício, 1", cidadeForo: "Florianópolis/SC", assinanteNome: "Diretora Fictícia", assinanteCargo: "Diretora" };
    expect((await c.req("PUT", "/api/configuracoes/contrato", dados)).statusCode).toBe(403);
    const admin = new Cliente(app);
    await admin.login("admin@bybus.test");
    expect((await admin.req("PUT", "/api/configuracoes/contrato", dados)).json()).toMatchObject({ assinanteNome: "Diretora Fictícia" });
  });

  it("quem não lança reservas não acessa", async () => {
    const g = new Cliente(app);
    await g.login("guia@bybus.test");
    expect((await g.req("GET", "/api/grupos")).statusCode).toBe(403);
  });
});
