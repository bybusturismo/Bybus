import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { afiliados, finLancamentos, passageiros, passeios, reservas, saidas, vendas } from "../src/db/schema.js";
import { sincronizarAfiliadosPaytour } from "../src/servicos/afiliadosComissao.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const comDb = async <T>(f: (db: ReturnType<typeof criarDb>["db"]) => Promise<T>) => {
  const { db, pool } = criarDb(DATABASE_URL);
  try { return await f(db); } finally { await pool.end(); }
};
const futuro = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
const ids = {} as { realizada: string; futura: string; faltou: string; cancelada: string };

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  await comDb(async (db) => {
    const [p] = await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA"));
    const saida = async (data: string) => (await db.insert(saidas).values({ passeioId: p!.id, data, capacidade: 40 }).onConflictDoNothing().returning())[0]
      ?? (await db.select().from(saidas).where(eq(saidas.data, data)))[0]!;
    const s20 = await saida("2026-10-20"), s25 = await saida("2026-10-25"), sF = await saida(futuro);
    const venda = async (codigo: string, afiliado: string, comissao: number) => (await db.insert(vendas).values({
      pedidoCodigo: codigo, fonte: "PAYTOUR_API", canalVenda: "AFILIADO", valorCentavos: 40000, afiliadoId: afiliado, afiliadoComissaoCentavos: comissao,
      dataHoraCompra: new Date("2026-10-02T15:00:00Z"),
    }).returning())[0]!;
    const reserva = async (vendaId: string, saidaId: string, valor: number, embarque: "EMBARCOU" | "NO_SHOW" | "PENDENTE", status: "CONFIRMADA" | "CANCELADA" = "CONFIRMADA") => {
      const [r] = await db.insert(reservas).values({ saidaId, vendaId, canal: "PAYTOUR", origem: "FICTICIO", contatoNome: "Cliente Fictício", valorCentavos: valor, status }).returning();
      await db.insert(passageiros).values({ reservaId: r!.id, nome: "Passageiro Fictício", categoria: "ADULTO", embarque });
      return r!.id;
    };
    const a = await venda("PAYTOUR-T-1", "777", 1000);
    ids.realizada = await reserva(a.id, s20.id, 30000, "EMBARCOU");
    ids.futura = await reserva(a.id, sF.id, 10000, "PENDENTE");
    const b = await venda("PAYTOUR-T-2", "777", 500);
    ids.faltou = await reserva(b.id, s25.id, 20000, "NO_SHOW");
    const c = await venda("PAYTOUR-T-3", "888", 300);
    ids.cancelada = await reserva(c.id, s25.id, 15000, "PENDENTE", "CANCELADA");
    await sincronizarAfiliadosPaytour(db, { "777": "Hotel Fictício Sol" });
  });
});
afterAll(async () => fechar());

describe("comissões de afiliados (13/11/2026)", () => {
  it("cadastra os afiliados da Paytour que aparecem nas vendas (sem duplicar)", async () => {
    const lista = await comDb(async (db) => {
      await sincronizarAfiliadosPaytour(db, { "777": "Outro nome" });
      return db.select().from(afiliados).where(eq(afiliados.codigo, "PT-777"));
    });
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ nome: "Hotel Fictício Sol", paytourAfiliadoId: "777" });
  });

  it("calcula por reserva: rateia o pedido, só vale depois do passeio, não compareceu e cancelada não geram", async () => {
    const c = new Cliente(app);
    await c.login("admin@bybus.test");
    const r = await c.req("GET", `/api/afiliados/comissoes?de=2026-10-01&ate=${futuro}&por=PASSEIO`);
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json();
    const de = (id: string) => j.itens.find((x: { reservaId: string }) => x.reservaId === id);
    expect(de(ids.realizada)).toMatchObject({ comissaoCentavos: 750, situacao: "A_PAGAR", dataPagamento: "2026-11-01", afiliadoNome: "Hotel Fictício Sol" });
    expect(de(ids.futura)).toMatchObject({ comissaoCentavos: 250, situacao: "PREVISTA" });
    expect(de(ids.faltou)).toMatchObject({ situacao: "CANCELADA" });
    expect(de(ids.cancelada)).toMatchObject({ situacao: "CANCELADA" });
    expect(j.totais).toMatchObject({ aPagarCentavos: 750, previstaCentavos: 250 });
    expect(j.ranking[0]).toMatchObject({ nome: "Hotel Fictício Sol", reservas: 2, comissaoCentavos: 1000 });
  });

  it("pagamento quinzenal vira conta a pagar (uma vez só); desfazer devolve as comissões", async () => {
    const c = new Cliente(app);
    await c.login("admin@bybus.test");
    expect((await c.req("POST", "/api/afiliados/pagamentos", { dataPagamento: "2026-11-10" })).statusCode).toBe(400);
    const g = await c.req("POST", "/api/afiliados/pagamentos", { dataPagamento: "2026-11-01" });
    expect(g.statusCode, g.body).toBe(200);
    expect(g.json()).toMatchObject({ pagamentos: 1, comissoes: 1, totalCentavos: 750 });
    expect((await c.req("POST", "/api/afiliados/pagamentos", { dataPagamento: "2026-11-01" })).json()).toMatchObject({ pagamentos: 0 });
    const lista = (await c.req("GET", "/api/afiliados/pagamentos")).json();
    expect(lista[0]).toMatchObject({ afiliado: "Hotel Fictício Sol", totalCentavos: 750, situacaoConta: "ABERTO", dataPagamento: "2026-11-01" });
    const [l] = await comDb((db) => db.select().from(finLancamentos).where(eq(finLancamentos.id, lista[0].lancamentoId)));
    expect(l).toMatchObject({ tipo: "PAGAR", valorCentavos: 750, vencimento: "2026-11-01", contraparte: "Hotel Fictício Sol", origem: "AFILIADOS" });
    const it = (await c.req("GET", `/api/afiliados/comissoes?de=2026-10-01&ate=2026-10-31`)).json().itens.find((x: { reservaId: string }) => x.reservaId === ids.realizada);
    expect(it).toMatchObject({ situacao: "A_PAGAR", pagamentoId: lista[0].id });
    expect((await c.req("DELETE", `/api/afiliados/pagamentos/${lista[0].id}`)).statusCode).toBe(200);
    expect(await comDb((db) => db.select().from(finLancamentos).where(eq(finLancamentos.id, lista[0].lancamentoId)))).toHaveLength(0);
    const depois = (await c.req("GET", `/api/afiliados/comissoes?de=2026-10-01&ate=2026-10-31`)).json().itens.find((x: { reservaId: string }) => x.reservaId === ids.realizada);
    expect(depois).toMatchObject({ situacao: "A_PAGAR", pagamentoId: null });
  });

  it("sem financeiro nem marketing não vê; gerar pagamento exige financeiro:gerenciar", async () => {
    const at = new Cliente(app);
    await at.login("guia@bybus.test");
    expect((await at.req("GET", "/api/afiliados/comissoes?de=2026-10-01&ate=2026-10-31")).statusCode).toBe(403);
    expect((await at.req("POST", "/api/afiliados/pagamentos", { dataPagamento: "2026-11-01" })).statusCode).toBe(403);
  });
});
