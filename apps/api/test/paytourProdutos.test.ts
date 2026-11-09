import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { passeios, paytourProdutos, unidades } from "../src/db/schema.js";
import { casaProduto } from "../src/servicos/importacao.js";
import { anotarProdutosDesconhecidos } from "../src/servicos/paytour.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const { db, pool } = criarDb(DATABASE_URL);
let admin: Cliente;

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  admin = new Cliente(app);
  await admin.login("admin@bybus.test");
});
afterAll(async () => { await fechar(); await pool.end(); });

describe("produtos da Paytour não reconhecidos", () => {
  it("anota e soma os produtos que nenhum passeio reconhece", async () => {
    const aviso = (p: string) => ({ avisos: [`Produto não reconhecido: "${p}".`] });
    await anotarProdutosDesconhecidos(db, [aviso("Ingresso Parque Fictício (adulto)"), aviso("Ingresso Parque Fictício (adulto)"), aviso("Passeio Fictício Noturno"), { avisos: ["outro aviso"] }]);
    await anotarProdutosDesconhecidos(db, [aviso("Passeio Fictício Noturno")]);
    const lista = (await admin.req("GET", "/api/integracoes/paytour/produtos")).json();
    expect(lista.produtos.map((p: { produto: string; pedidos: number }) => [p.produto, p.pedidos])).toEqual([["Ingresso Parque Fictício (adulto)", 2], ["Passeio Fictício Noturno", 2]]);
  });

  it("revenda sai da lista; passeio novo passa a reconhecer o produto (nome exato, com parênteses)", async () => {
    await admin.req("POST", "/api/integracoes/paytour/produtos/decidir", { produto: "Ingresso Parque Fictício (adulto)", acao: "REVENDA" });
    const [fln] = await db.select().from(unidades).where(eq(unidades.codigo, "FLN"));
    const r = (await admin.req("POST", "/api/integracoes/paytour/produtos/decidir", { produto: "Passeio Fictício Noturno", acao: "NOVO_PASSEIO", unidadeId: fln!.id })).json();
    const [p] = await db.select().from(passeios).where(eq(passeios.id, r.passeioId));
    expect(p).toMatchObject({ nome: "Passeio Fictício Noturno", unidadeId: fln!.id, ativo: true });
    expect(casaProduto(p!.padraoProduto, "Passeio Fictício Noturno")).toBe(true);
    expect((await admin.req("GET", "/api/integracoes/paytour/produtos")).json().produtos).toEqual([]);
    expect((await db.select().from(paytourProdutos)).every((x) => x.decisao)).toBe(true);
  });

  it("vincular a um passeio existente mantém o que ele já reconhecia", async () => {
    await anotarProdutosDesconhecidos(db, [{ avisos: ['Produto não reconhecido: "City Tour Toda Ilha (promo fictícia)".'] }]);
    const [toda] = await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA"));
    const antes = toda!.padraoProduto;
    await admin.req("POST", "/api/integracoes/paytour/produtos/decidir", { produto: "City Tour Toda Ilha (promo fictícia)", acao: "PASSEIO_EXISTENTE", passeioId: toda!.id });
    const [depois] = await db.select().from(passeios).where(eq(passeios.id, toda!.id));
    expect(casaProduto(depois!.padraoProduto, "City Tour Toda Ilha (promo fictícia)")).toBe(true);
    if (antes) expect(depois!.padraoProduto).toContain(antes);
    const guia = new Cliente(app);
    await guia.login("guia@bybus.test");
    expect((await guia.req("GET", "/api/integracoes/paytour/produtos")).statusCode).toBe(403);
  });
});
