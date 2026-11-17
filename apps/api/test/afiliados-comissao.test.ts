import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { afiliados, finContas, finExtratoLinhas, finLancamentos, passageiros, passeios, reservas, saidas, vendas } from "../src/db/schema.js";
import { sincronizarAfiliadosPaytour, sincronizarParceirosPaytour } from "../src/servicos/afiliadosComissao.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";
import { emailsDeTeste } from "../src/servicos/email.js";

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
  ({ app, fechar } = await subirApp({ URL_PUBLICA: "https://gestao.exemplo.test", EMAIL_USUARIO: "envio@exemplo.test", EMAIL_SENHA: "senha-ficticia" }));
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
    // Sem o corte do histórico, não gera (evita pagar de novo o que já foi pago fora do sistema).
    expect((await c.req("POST", "/api/afiliados/pagamentos", { dataPagamento: "2026-11-01" })).json().codigo).toBe("SEM_CORTE");
    expect((await c.req("PUT", "/api/afiliados/corte", { pagasAte: "2026-10-22" })).statusCode).toBe(200);
    // Corte em 22/10: a reserva de 20/10 conta como paga fora; volta para 15/10 para seguir o teste.
    const it0 = (await c.req("GET", `/api/afiliados/comissoes?de=2026-10-01&ate=2026-10-31`)).json().itens.find((x: { reservaId: string }) => x.reservaId === ids.realizada);
    expect(it0).toMatchObject({ situacao: "PAGA", pagamentoId: null });
    expect((await c.req("PUT", "/api/afiliados/corte", { pagasAte: "2026-10-15" })).statusCode).toBe(200);
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
    // Paga só depois da conciliação com o extrato (17/11/2026): a baixa sozinha ainda é "a pagar".
    const comissaoDa = async () => (await c.req("GET", `/api/afiliados/comissoes?de=2026-10-01&ate=2026-10-31`)).json().itens.find((x: { reservaId: string }) => x.reservaId === ids.realizada);
    await comDb((db) => db.update(finLancamentos).set({ situacao: "REALIZADO", pagoEm: "2026-11-01", valorPagoCentavos: 750 }).where(eq(finLancamentos.id, lista[0].lancamentoId)));
    expect(await comissaoDa()).toMatchObject({ situacao: "A_PAGAR" });
    expect((await c.req("GET", "/api/afiliados/pagamentos")).json()[0]).toMatchObject({ situacaoConta: "REALIZADO", conciliado: false });
    const linhaId = await comDb(async (db) => {
      const [k] = await db.insert(finContas).values({ nome: "Banco Fictício Comissões", tipo: "CORRENTE" }).returning();
      const [ln] = await db.insert(finExtratoLinhas).values({ contaId: k!.id, idUnico: "com-1", data: "2026-11-01", valorCentavos: -750, descricao: "PIX AFILIADO", status: "CONCILIADO", lancamentoId: lista[0].lancamentoId }).returning();
      return ln!.id;
    });
    expect(await comissaoDa()).toMatchObject({ situacao: "PAGA" });
    expect((await c.req("GET", "/api/afiliados/pagamentos")).json()[0]).toMatchObject({ conciliado: true });
    // Volta ao estado anterior para o resto do teste (desfazer só vale com a conta em aberto).
    await comDb(async (db) => {
      await db.delete(finExtratoLinhas).where(eq(finExtratoLinhas.id, linhaId));
      await db.update(finLancamentos).set({ situacao: "ABERTO", pagoEm: null, valorPagoCentavos: null }).where(eq(finLancamentos.id, lista[0].lancamentoId));
    });
    expect((await c.req("DELETE", `/api/afiliados/pagamentos/${lista[0].id}`)).statusCode).toBe(200);
    expect(await comDb((db) => db.select().from(finLancamentos).where(eq(finLancamentos.id, lista[0].lancamentoId)))).toHaveLength(0);
    const depois = (await c.req("GET", `/api/afiliados/comissoes?de=2026-10-01&ate=2026-10-31`)).json().itens.find((x: { reservaId: string }) => x.reservaId === ids.realizada);
    expect(depois).toMatchObject({ situacao: "A_PAGAR", pagamentoId: null });
  });

  it("portal do afiliado: a equipe cria o acesso, ele cria a senha e vê só as próprias comissões e cadastra os dados bancários", async () => {
    const admin = new Cliente(app);
    await admin.login("admin@bybus.test");
    const [a] = await comDb((db) => db.select().from(afiliados).where(eq(afiliados.codigo, "PT-777")));
    emailsDeTeste.length = 0;
    const acesso = await admin.req("POST", `/api/marketing/afiliados/${a!.id}/acesso`, { email: "hotel.sol@exemplo.test" });
    expect(acesso.statusCode, acesso.body).toBe(200);
    expect(acesso.json()).toMatchObject({ emailEnviado: true, validadeHoras: 72 });
    expect((await admin.req("POST", `/api/marketing/afiliados/${a!.id}/acesso`, { email: "outro@exemplo.test" })).statusCode).toBe(409);
    const codigo = /c=([A-Za-z0-9_-]+)/.exec(emailsDeTeste[0]!.texto)![1]!;
    const senha = "Senha-Ficticia-2026!";
    expect((await new Cliente(app).req("POST", "/api/auth/redefinir", { codigo, senha })).statusCode).toBe(200);
    const af = new Cliente(app);
    expect((await af.login("hotel.sol@exemplo.test", senha)).statusCode).toBe(200);
    const p = await af.req("GET", "/api/portal-afiliado");
    expect(p.statusCode, p.body).toBe(200);
    const j = p.json();
    expect(j.afiliado).toMatchObject({ nome: "Hotel Fictício Sol", codigo: "PT-777" });
    expect(j.afiliado.link).toContain("ref=PT-777");
    expect(j.comissoes.length).toBe(3); // só as do 777 (realizada, futura e a que não compareceu)
    expect(JSON.stringify(j)).not.toMatch(/888|Cliente Fictício|Passageiro/);
    expect(j.dadosBancarios).toBeNull();
    expect((await af.req("PUT", "/api/portal-afiliado/dados-bancarios", { titular: "Hotel Fictício Sol", documento: "00.000.000/0001-00" })).statusCode).toBe(400);
    expect((await af.req("PUT", "/api/portal-afiliado/dados-bancarios", { titular: "Hotel Fictício Sol", documento: "00.000.000/0001-00", pix: "pix@exemplo.test" })).statusCode).toBe(200);
    expect((await af.req("GET", "/api/portal-afiliado")).json().dadosBancarios).toMatchObject({ pix: "pix@exemplo.test" });
    // O afiliado não acessa o resto do sistema.
    expect((await af.req("GET", "/api/afiliados/comissoes?de=2026-10-01&ate=2026-10-31")).statusCode).toBe(403);
    expect((await af.req("GET", "/api/grupos")).statusCode).toBe(403);
    // O financeiro vê os dados bancários para pagar (auditado).
    expect((await admin.req("GET", `/api/marketing/afiliados/${a!.id}/dados-bancarios`)).json().dados).toMatchObject({ pix: "pix@exemplo.test" });
    // Remover o acesso derruba o login.
    expect((await admin.req("DELETE", `/api/marketing/afiliados/${a!.id}/acesso`)).statusCode).toBe(200);
    expect((await new Cliente(app).login("hotel.sol@exemplo.test", senha)).statusCode).not.toBe(200);
  });

  it("sem financeiro nem marketing não vê; gerar pagamento exige financeiro:gerenciar", async () => {
    const at = new Cliente(app);
    await at.login("guia@bybus.test");
    expect((await at.req("GET", "/api/afiliados/comissoes?de=2026-10-01&ate=2026-10-31")).statusCode).toBe(403);
    expect((await at.req("POST", "/api/afiliados/pagamentos", { dataPagamento: "2026-11-01" })).statusCode).toBe(403);
  });

  it("canal interno (\"Tripadvisor interno\") nasce sem comissão e não aparece nas comissões nem no ranking (17/11/2026)", async () => {
    const reservaId = await comDb(async (db) => {
      const [p] = await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA"));
      const [s] = await db.select().from(saidas).where(eq(saidas.data, "2026-10-20"));
      const [v] = await db.insert(vendas).values({ pedidoCodigo: "PAYTOUR-T-9", fonte: "PAYTOUR_API", canalVenda: "AFILIADO", valorCentavos: 9000, afiliadoId: "999", afiliadoComissaoCentavos: 900, dataHoraCompra: new Date("2026-10-02T15:00:00Z") }).returning();
      const [r] = await db.insert(reservas).values({ saidaId: s!.id, vendaId: v!.id, canal: "PAYTOUR", origem: "FICTICIO", contatoNome: "Cliente Fictício", valorCentavos: 9000 }).returning();
      await db.insert(passageiros).values({ reservaId: r!.id, nome: "Passageiro Fictício", categoria: "ADULTO", embarque: "EMBARCOU" });
      void p;
      await sincronizarAfiliadosPaytour(db, { "999": "Tripadvisor interno" });
      return r!.id;
    });
    const [interno] = await comDb((db) => db.select().from(afiliados).where(eq(afiliados.paytourAfiliadoId, "999")));
    expect(interno).toMatchObject({ nome: "Tripadvisor interno", modoComissao: "NENHUMA" });
    const c = new Cliente(app);
    await c.login("admin@bybus.test");
    const ver = async () => (await c.req("GET", `/api/afiliados/comissoes?de=2026-10-01&ate=${futuro}&por=PASSEIO`)).json();
    const j = await ver();
    expect(j.itens.some((x: { reservaId: string }) => x.reservaId === reservaId)).toBe(false);
    expect(j.ranking.some((x: { nome: string }) => x.nome === "Tripadvisor interno")).toBe(false);
    // Desmarcado na ficha do afiliado, volta a aparecer.
    await comDb((db) => db.update(afiliados).set({ modoComissao: "PAGAMOS" }).where(eq(afiliados.id, interno!.id)));
    expect((await ver()).itens.some((x: { reservaId: string }) => x.reservaId === reservaId)).toBe(true);
    await comDb((db) => db.update(afiliados).set({ modoComissao: "NENHUMA" }).where(eq(afiliados.id, interno!.id)));
  });

  it("Inzama Travel retém 15% na venda: aparece como retida, nunca vai para o contas a pagar; relatório em PDF (17/11/2026)", async () => {
    const reservaId = await comDb(async (db) => {
      const [s] = await db.select().from(saidas).where(eq(saidas.data, "2026-10-20"));
      // A Paytour não informa comissão (ela retém por fora): vale o percentual do cadastro (15%).
      const [v] = await db.insert(vendas).values({ pedidoCodigo: "PAYTOUR-T-INZ", fonte: "PAYTOUR_API", canalVenda: "AFILIADO", valorCentavos: 20000, afiliadoId: "555", afiliadoComissaoCentavos: 0, dataHoraCompra: new Date("2026-10-02T15:00:00Z") }).returning();
      const [r] = await db.insert(reservas).values({ saidaId: s!.id, vendaId: v!.id, canal: "PAYTOUR", origem: "FICTICIO", contatoNome: "Cliente Fictício", valorCentavos: 20000 }).returning();
      await db.insert(passageiros).values({ reservaId: r!.id, nome: "Passageiro Fictício", categoria: "ADULTO", embarque: "EMBARCOU" });
      await sincronizarAfiliadosPaytour(db, { "555": "Inzama Travel" });
      await db.update(afiliados).set({ modoComissao: "RETEM", comissaoPontosBase: 1500 }).where(eq(afiliados.paytourAfiliadoId, "555"));
      return r!.id;
    });
    const c = new Cliente(app);
    await c.login("admin@bybus.test");
    const j = (await c.req("GET", `/api/afiliados/comissoes?de=2026-10-01&ate=${futuro}&por=PASSEIO`)).json();
    const inz = j.itens.find((x: { reservaId: string }) => x.reservaId === reservaId);
    expect(inz).toMatchObject({ afiliadoNome: "Inzama Travel", situacao: "RETIDA", comissaoCentavos: 3000, retem: true });
    expect(j.totais.retidaCentavos).toBe(3000);
    expect(j.ranking.find((x: { nome: string }) => x.nome === "Inzama Travel")).toMatchObject({ retem: true, comissaoCentavos: 3000 });

    // O pagamento quinzenal não inclui a retida.
    await c.req("PUT", "/api/afiliados/corte", { pagasAte: "2026-09-30" });
    const g = await c.req("POST", "/api/afiliados/pagamentos", { dataPagamento: "2026-11-01" });
    expect([200, 201, 409]).toContain(g.statusCode);
    const contas = await comDb((db) => db.select().from(finLancamentos));
    expect(contas.some((l) => /inzama/i.test(l.descricao))).toBe(false);

    const pdf = await c.req("GET", `/api/afiliados/comissoes/relatorio.pdf?de=2026-10-01&ate=${futuro}&por=PASSEIO`);
    expect(pdf.statusCode, pdf.body.slice(0, 200)).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe("%PDF");
    expect((await c.req("GET", `/api/afiliados/comissoes/relatorio.pdf?de=2026-10-01&ate=${futuro}&situacao=RETIDA`)).statusCode).toBe(200);
    const semPermissao = new Cliente(app);
    await semPermissao.login("guia@bybus.test");
    expect((await semPermissao.req("GET", `/api/afiliados/comissoes/relatorio.pdf?de=2026-10-01&ate=${futuro}`)).statusCode).toBe(403);
  });

  it("parceiro da Paytour (agência, ex.: Inzama) entra nas comissões como retida, ganha o nome e nunca gera conta a pagar (17/11/2026)", async () => {
    const reservaId = await comDb(async (db) => {
      const [s] = await db.select().from(saidas).where(eq(saidas.data, "2026-10-20"));
      const [v] = await db.insert(vendas).values({ pedidoCodigo: "PAYTOUR-T-PARC", fonte: "PAYTOUR_API", canalVenda: "PARCEIRO", valorCentavos: 10000, parceiroId: "11980", parceiroComissaoCentavos: null, dataHoraCompra: new Date("2026-10-02T15:00:00Z") }).returning();
      const [r] = await db.insert(reservas).values({ saidaId: s!.id, vendaId: v!.id, canal: "PAYTOUR", origem: "FICTICIO", contatoNome: "Cliente Fictício", valorCentavos: 10000 }).returning();
      await db.insert(passageiros).values({ reservaId: r!.id, nome: "Passageiro Fictício", categoria: "ADULTO", embarque: "EMBARCOU" });
      await sincronizarParceirosPaytour(db, {}); // a Paytour não devolveu o nome
      return r!.id;
    });
    const [p0] = await comDb((db) => db.select().from(afiliados).where(eq(afiliados.paytourParceiroId, "11980")));
    expect(p0).toMatchObject({ nome: "Parceiro Paytour 11980", codigo: "PP-11980", modoComissao: "RETEM", comissaoPontosBase: 1500 });
    const c = new Cliente(app);
    await c.login("admin@bybus.test");
    const item = async () => (await c.req("GET", `/api/afiliados/comissoes?de=2026-10-01&ate=${futuro}&por=PASSEIO`)).json().itens.find((x: { reservaId: string }) => x.reservaId === reservaId);
    expect(await item()).toMatchObject({ afiliadoNome: "Parceiro Paytour 11980", situacao: "RETIDA", comissaoCentavos: 1500, retem: true });
    // Quando a Paytour devolver o nome, o cadastro é atualizado (nome editado pela equipe não muda).
    await comDb((db) => sincronizarParceirosPaytour(db, { "11980": "Inzama Travel" }));
    expect(await item()).toMatchObject({ afiliadoNome: "Inzama Travel", situacao: "RETIDA" });
    await comDb((db) => sincronizarParceirosPaytour(db, { "11980": "Outro Nome" }));
    expect((await item()).afiliadoNome).toBe("Inzama Travel");
  });
});
