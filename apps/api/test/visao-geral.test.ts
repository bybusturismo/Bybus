import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { criarDb } from "../src/db/cliente.js";
import { auditoria, passageiros, passeios, reservas, saidas, unidades, vendas } from "../src/db/schema.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
let admin: Cliente;
let supBc: Cliente; // praça BC: marketing:ver, sem financeiro
let analista: Cliente; // FLN: manifesto:ver + marketing:ver, sem financeiro
let guia: Cliente; // FLN: só manifesto:ver
let flnId = "";
let bcId = "";
let passeioFln = "";
let passeioBc = "";
const { db, pool } = criarDb(DATABASE_URL);

const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dias = (n: number) => new Date(Date.parse(`${hoje}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
/** Instante UTC de "AAAA-MM-DD HH:MM" em Brasília. */
const sp = (dia: string, hm: string) => new Date(`${dia}T${hm}:00-03:00`);

async function novoUsuario(perfil: string, permissoes: string[], email: string, unidadeIds: string[]) {
  expect((await admin.req("POST", "/api/perfis", { codigo: perfil, nome: perfil, permissoes })).statusCode).toBe(200);
  const { senhaTemporaria } = (await admin.req("POST", "/api/usuarios", { nome: `Usuário ${perfil}`, email, perfil, unidadeIds })).json();
  const c = new Cliente(app);
  await c.login(email, senhaTemporaria);
  await c.req("POST", "/api/auth/senha", { senhaAtual: senhaTemporaria, novaSenha: "VgTeste123456" });
  return c;
}

async function saida(passeioId: string, data: string, capacidade = 10) {
  const [s] = await db.insert(saidas).values({ passeioId, data, capacidade }).onConflictDoNothing().returning();
  if (s) return s.id;
  return (await db.select().from(saidas).where(and(eq(saidas.passeioId, passeioId), eq(saidas.data, data))))[0]!.id;
}
async function venda(codigo: string, v: Partial<typeof vendas.$inferInsert> & { valorCentavos: number; canalVenda: string }) {
  const [x] = await db.insert(vendas).values({ pedidoCodigo: codigo, fonte: "PAYTOUR_API", ...v }).returning();
  return x!.id;
}
async function reserva(saidaId: string, r: Partial<typeof reservas.$inferInsert> & { contatoNome: string }) {
  const [x] = await db.insert(reservas).values({ saidaId, canal: "PAYTOUR", origem: "PAYTOUR_API", ...r }).returning();
  return x!.id;
}

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  admin = new Cliente(app);
  expect((await admin.login("admin@bybus.test")).statusCode).toBe(200);
  // Os dados fictícios do banco de teste trazem reservas; aqui só valem as do próprio teste (contagens exatas).
  await db.execute(sql`truncate table reservas, saidas cascade`);
  const us = await db.select().from(unidades);
  flnId = us.find((u) => u.codigo === "FLN")!.id;
  bcId = us.find((u) => u.codigo === "BC")!.id;
  passeioFln = (await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA")))[0]!.id;
  [{ id: passeioBc }] = await db.insert(passeios).values({ codigo: "BC_TOUR_TESTE", nome: "City Tour BC (teste)", cidade: "Balneário Camboriú", unidadeId: bcId, capacidadePadrao: 40, minimoConfirmacao: 5, minimoSupervisor: 4 }).returning({ id: passeios.id }) as [{ id: string }];
  supBc = await novoUsuario("VG_BC", ["manifesto:ver", "marketing:ver"], "vg.bc@bybus.test", [bcId]);
  analista = await novoUsuario("VG_ANALISTA", ["manifesto:ver", "marketing:ver"], "vg.analista@bybus.test", [flnId]);
  guia = await novoUsuario("VG_GUIA", ["manifesto:ver"], "vg.guia@bybus.test", [flnId]);

  // Dados fictícios (todos com "Teste" no nome). Pedido A: site, 2 reservas em 2 saídas; B: admin com saldo; C: afiliado em BC.
  const sHoje = await saida(passeioFln, hoje);
  const sAmanha = await saida(passeioFln, dias(1));
  const sBc = await saida(passeioBc, dias(2));
  const compraHoje = sp(hoje, "15:00");
  const vA = await venda("PAYTOUR-T1", { canalVenda: "SITE", valorCentavos: 10000, descontoCentavos: 1000, cupomExternoId: "415", metodoPagamento: "cielo", parcelas: 3, dataHoraCompra: compraHoje, clienteCidade: "Curitiba" });
  const vB = await venda("PAYTOUR-T2", { canalVenda: "ADMIN", valorCentavos: 20000, operadorId: "48", metodoPagamento: "pagamento_no_dia", pagamentoPendenteCentavos: 5000, dataHoraCompra: sp(hoje, "02:30"), clienteCidade: "Curitiba" });
  const vC = await venda("PAYTOUR-T3", { canalVenda: "AFILIADO", valorCentavos: 30000, afiliadoId: "454", afiliadoComissaoCentavos: 3000, metodoPagamento: "zoop_pix", dataHoraCompra: compraHoje });
  const vAntiga = await venda("PAYTOUR-T4", { canalVenda: "SITE", valorCentavos: 7000, dataHoraCompra: sp(dias(-365), "12:00") });
  const idA1 = await reserva(sHoje, { contatoNome: "Cliente Teste A1", vendaId: vA, valorCentavos: 6000, descontoCentavos: 600, origemCliente: "PR", pagamento: "PAGO" });
  await db.insert(passageiros).values([{ reservaId: idA1, categoria: "ADULTO" }, { reservaId: idA1, categoria: "ADULTO", embarque: "EMBARCOU" }, { reservaId: idA1, categoria: "COLO" }]);
  await reserva(sAmanha, { contatoNome: "Cliente Teste A2", vendaId: vA, valorCentavos: 4000, descontoCentavos: 400, origemCliente: "PR", conferencia: "CONFERIDA" });
  await reserva(sHoje, { contatoNome: "Cliente Teste B", vendaId: vB, valorCentavos: 20000, origemCliente: "SC", pagamento: "A_PAGAR" });
  await reserva(sBc, { contatoNome: "Cliente Teste C", vendaId: vC, valorCentavos: 30000, origemCliente: "RS" });
  await reserva(sHoje, { contatoNome: "Cliente Teste Antigo", vendaId: vAntiga, valorCentavos: 7000, criadoEm: sp(dias(-365), "12:00") });
  await reserva(sHoje, { contatoNome: "Cliente Teste Balcao", canal: "BALCAO", origem: "MANUAL", valorCentavos: 5000, origemCliente: "SC" });
  await reserva(sHoje, { contatoNome: "Cliente Teste Viator", canal: "VIATOR", origem: "BOKUN_EMAIL", codigoExterno: "VIA-T1" });
  await reserva(sHoje, { contatoNome: "Cliente Teste Cancelada", vendaId: vA, valorCentavos: 99999, status: "CANCELADA" });
  await db.update(passeios).set({ ativo: true }).where(eq(passeios.id, passeioFln));
});
afterAll(async () => {
  await pool.end();
  await fechar();
});

const periodo = `de=${dias(-29)}&ate=${hoje}`;

describe("permissões da Visão Geral", () => {
  it("sem login 401; sem manifesto:ver 403", async () => {
    expect((await new Cliente(app).req("GET", "/api/visao-geral/resumo")).statusCode).toBe(401);
    const semNada = await novoUsuario("VG_NADA", ["biblioteca:ver"], "vg.nada@bybus.test", [flnId]);
    expect((await semNada.req("GET", "/api/visao-geral/resumo")).statusCode).toBe(403);
    expect((await semNada.req("GET", "/api/reservas")).statusCode).toBe(403);
  });

  it("sem financeiro:ver nenhum valor em R$ sai; blocos só em R$ dão 403", async () => {
    const r = (await analista.req("GET", "/api/visao-geral/resumo")).json();
    expect(r.faturamentoMes.valorCentavos).toBeNull();
    expect(r.faturamentoMes.mesAnteriorCentavos).toBeNull();
    expect(r.cupons.usos).toBe(1);
    expect(r.cupons.descontoCentavos).toBeNull();
    expect(r.aguardandoPagamento.saldoCentavos).toBeNull();
    expect(r.comissaoAfiliados.totalCentavos).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/"(valor|desconto|saldo|total)Centavos":\s*[1-9]/);
    for (const rota of ["faturamento", "comparativo"]) expect((await analista.req("GET", `/api/visao-geral/${rota}?${periodo}`)).statusCode).toBe(403);
    const em = (await analista.req("GET", `/api/visao-geral/emissores?${periodo}`)).json();
    expect(em.baseDoPercentual).toBe("reservas");
    expect(em.emissores.every((e: { valorCentavos: unknown }) => e.valorCentavos === null)).toBe(true);
    const ps = (await analista.req("GET", `/api/visao-geral/passeios?${periodo}`)).json();
    expect(ps.total.valorCentavos).toBeNull();
    const pg = (await analista.req("GET", `/api/visao-geral/pagamentos?${periodo}`)).json();
    expect(pg.formas.every((f: { valorCentavos: unknown }) => f.valorCentavos === null)).toBe(true);
  });

  it("quem só tem manifesto:ver vê a operação, mas não as análises de vendas", async () => {
    expect((await guia.req("GET", "/api/visao-geral/resumo")).statusCode).toBe(200);
    for (const rota of ["emissores", "dia-semana", "horario-compra", "passeios", "pagamentos", "faturamento", "comparativo"]) {
      expect((await guia.req("GET", `/api/visao-geral/${rota}?${periodo}`)).statusCode, rota).toBe(403);
    }
  });
});

describe("escopo de praça", () => {
  it("usuário de BC só vê BC; FLN não vê BC", async () => {
    const bc = (await supBc.req("GET", `/api/visao-geral/passeios?${periodo}`)).json();
    expect(bc.passeios.map((p: { passeio: string }) => p.passeio)).toEqual(["City Tour BC (teste)"]);
    expect(bc.total.reservas).toBe(1);
    const fln = (await analista.req("GET", `/api/visao-geral/passeios?${periodo}`)).json();
    expect(fln.passeios.map((p: { passeio: string }) => p.passeio)).not.toContain("City Tour BC (teste)");
    const rBc = (await supBc.req("GET", "/api/visao-geral/resumo")).json();
    expect(rBc.faturamentoMes.reservas).toBe(1);
    expect(rBc.saidasHoje).toEqual([]); // as saídas de hoje são de FLN
    expect(rBc.pendencias.aConferir).toBe(1);
  });

  it("pedir outra praça ou passeio de fora do escopo é 404", async () => {
    expect((await supBc.req("GET", `/api/visao-geral/passeios?${periodo}&unidadeId=${flnId}`)).statusCode).toBe(404);
    expect((await supBc.req("GET", `/api/visao-geral/emissores?${periodo}&passeioId=${passeioFln}`)).statusCode).toBe(404);
    expect((await supBc.req("GET", `/api/visao-geral/resumo?unidadeId=${flnId}`)).statusCode).toBe(404);
    expect((await analista.req("GET", `/api/reservas?unidadeId=${bcId}`)).statusCode).toBe(404);
  });

  it("admin vê as duas praças e pode filtrar", async () => {
    const todas = (await admin.req("GET", `/api/visao-geral/passeios?${periodo}`)).json();
    expect(todas.total.reservas).toBe(6); // A1, A2, B, C, balcão e Viator (a antiga e a cancelada ficam fora)
    expect(todas.passeios.map((p: { passeio: string }) => p.passeio)).toContain("City Tour BC (teste)");
  });
});

describe("blocos", () => {
  it("resumo do admin: faturamento do mês, cupons, pendências, saldo, comissão e saídas de hoje", async () => {
    const r = (await admin.req("GET", "/api/visao-geral/resumo")).json();
    // A1 6000 + A2 4000 + B 20000 + C 30000 + balcão 5000 (a antiga e a cancelada ficam fora)
    expect(r.faturamentoMes.valorCentavos).toBe(65000);
    expect(r.faturamentoMes.reservas).toBe(6);
    expect(r.faturamentoMes.semValor).toBe(1); // a Viator sem valor
    expect(r.cupons).toMatchObject({ usos: 1, descontoCentavos: 1000, porCupom: [{ cupomId: "415", usos: 1, descontoCentavos: 1000 }] });
    expect(r.aguardandoPagamento).toEqual({ pedidos: 1, saldoCentavos: 5000 });
    expect(r.comissaoAfiliados).toEqual({ pedidos: 1, totalCentavos: 3000 });
    expect(r.whatsapp.disponivel).toBe(false);
    expect(r.ota.naoIntegradas).toContain("GetYourGuide");
    expect(r.saidasHoje).toHaveLength(1);
    expect(r.saidasHoje[0]).toMatchObject({ passeio: expect.stringContaining("Toda Ilha"), capacidade: 10, vendidos: 2, ocupacao: 20, checkinsPendentes: 1 }); // 2 assentos (o colo não conta); 1 já embarcou
    expect(r.pendencias.aConferir).toBeGreaterThanOrEqual(5);
    expect(r.pendencias.aPagarNoEmbarque).toBe(1);
  });

  it("faturamento por canal usa o canal de venda e a regra da reserva", async () => {
    const f = (await admin.req("GET", `/api/visao-geral/faturamento?${periodo}`)).json();
    expect(f.agrupamento).toBe("dia");
    expect(f.totaisPorCanal).toEqual({ SITE: 10000, ADMIN: 20000, AFILIADO: 30000, BALCAO: 5000, VIATOR: 0 });
    expect(f.totalCentavos).toBe(65000);
    const filtrado = (await admin.req("GET", `/api/visao-geral/faturamento?${periodo}&canal=ADMIN`)).json();
    expect(filtrado.totalCentavos).toBe(20000);
    const longo = (await admin.req("GET", `/api/visao-geral/faturamento?de=${dias(-200)}&ate=${hoje}`)).json();
    expect(longo.agrupamento).toBe("mes");
  });

  it("comparativo: mesmo período dos 3 últimos anos; ano anterior sem lançamentos fica zerado", async () => {
    const c = (await admin.req("GET", `/api/visao-geral/comparativo?${periodo}`)).json();
    expect(c.anos).toHaveLength(3);
    expect(c.anos[0].valorCentavos).toBe(65000);
    expect(c.anos[1].valorCentavos).toBe(7000);
    expect(c.anos[2].valorCentavos).toBe(0);
    expect(c.anos[0].ano).toBe(Number(hoje.slice(0, 4)));
  });

  it("dia da semana por canal, horário da compra (faixas) e pagamentos", async () => {
    const d = (await admin.req("GET", `/api/visao-geral/dia-semana?${periodo}`)).json();
    expect(d.dias).toHaveLength(7);
    expect(d.dias.reduce((t: number, x: { total: number }) => t + x.total, 0)).toBe(6);
    expect(d.canais).toEqual(expect.arrayContaining(["SITE", "ADMIN", "AFILIADO"]));
    const so = (await admin.req("GET", `/api/visao-geral/dia-semana?${periodo}&canal=SITE`)).json();
    expect(so.dias.reduce((t: number, x: { total: number }) => t + x.total, 0)).toBe(2);

    const h = (await admin.req("GET", `/api/visao-geral/horario-compra?${periodo}`)).json();
    expect(h.faixas.map((f: { rotulo: string }) => f.rotulo)).toEqual(["02–06", "06–10", "10–14", "14–18", "18–22", "22–02"]);
    expect(h.faixas[0]).toMatchObject({ site: 0, admin: 1 }); // B às 02:30 (Brasília)
    expect(h.faixas[3].site).toBe(2); // A1 e A2 às 15:00

    const p = (await admin.req("GET", `/api/visao-geral/pagamentos?${periodo}`)).json();
    const por = Object.fromEntries(p.formas.map((f: { forma: string; reservas: number }) => [f.forma, f.reservas]));
    expect(por).toMatchObject({ CARTAO_2_6X: 2, NO_DIA: 1, PIX: 1, CANAL: 1, OUTROS: 1 });
    expect(p.formas.reduce((t: number, f: { percentual: number }) => t + f.percentual, 0)).toBeGreaterThan(99);
  });

  it("emissores por cidade e UF, com R$ e percentual do valor", async () => {
    const e = (await admin.req("GET", `/api/visao-geral/emissores?${periodo}`)).json();
    expect(e.baseDoPercentual).toBe("valor");
    // agrupa por cidade e UF: C (RS, sem cidade) 30000; Curitiba/SC 20000; Curitiba/PR 10000
    expect(e.emissores[0]).toMatchObject({ cidade: "Cidade não informada", uf: "RS", reservas: 1, valorCentavos: 30000 });
    expect(e.emissores[1]).toMatchObject({ cidade: "Curitiba", uf: "SC", valorCentavos: 20000 });
    expect(e.emissores[2]).toMatchObject({ cidade: "Curitiba", uf: "PR", reservas: 2, valorCentavos: 10000 });
    expect(e.emissores[0].percentual).toBeCloseTo(30000 / 650, 0);
    const so = (await admin.req("GET", `/api/visao-geral/emissores?${periodo}&passeioId=${passeioBc}`)).json();
    expect(so.total.reservas).toBe(1);
  });

  it("período inválido ou longo demais é recusado com mensagem clara", async () => {
    const r = await admin.req("GET", `/api/visao-geral/passeios?de=${hoje}&ate=${dias(-3)}`);
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe("PERIODO_INVALIDO");
    expect((await admin.req("GET", "/api/visao-geral/passeios?de=2020-01-01&ate=2026-01-01")).json().codigo).toBe("PERIODO_LONGO");
    expect((await admin.req("GET", "/api/visao-geral/passeios?de=banana")).statusCode).toBe(400);
    expect((await admin.req("GET", "/api/visao-geral/dia-semana?canal=XYZ")).statusCode).toBe(400);
  });
});

describe("listagem geral de reservas", () => {
  it("filtra por período, canal, situação, conferência, pendência e busca; respeita praça e valores", async () => {
    const todas = (await admin.req("GET", `/api/reservas?de=${hoje}&ate=${dias(3)}`)).json();
    expect(todas.total).toBe(8);
    const fln = (await analista.req("GET", `/api/reservas?de=${hoje}&ate=${dias(3)}`)).json();
    expect(fln.reservas.find((r: { contatoNome: string }) => r.contatoNome === "Cliente Teste C")).toBeUndefined();
    expect(fln.reservas[0].valorCentavos).toBeUndefined();
    expect((await admin.req("GET", `/api/reservas?de=${hoje}&ate=${dias(3)}`)).json().reservas.find((r: { contatoNome: string }) => r.contatoNome === "Cliente Teste B").valorCentavos).toBe(20000);

    const viator = (await admin.req("GET", `/api/reservas?de=${hoje}&ate=${dias(3)}&canal=VIATOR`)).json();
    expect(viator.reservas.map((r: { codigoExterno: string }) => r.codigoExterno)).toEqual(["VIA-T1"]);
    expect((await admin.req("GET", `/api/reservas?de=${hoje}&ate=${dias(3)}&situacao=CANCELADA`)).json().total).toBe(1);
    expect((await admin.req("GET", `/api/reservas?de=${hoje}&ate=${dias(3)}&conferencia=CONFERIDA`)).json().total).toBe(1);
    const aPagar = (await admin.req("GET", "/api/reservas?pendencia=a_pagar")).json();
    expect(aPagar.total).toBe(1);
    expect(aPagar.reservas[0].contatoNome).toBe("Cliente Teste B");
    expect((await admin.req("GET", `/api/reservas?de=${hoje}&ate=${dias(3)}&busca=teste%20a2`)).json().total).toBe(1);
    expect((await admin.req("GET", `/api/reservas?de=${hoje}&ate=${dias(3)}&busca=via-t1`)).json().total).toBe(1);
    // % e _ na busca não viram curinga
    expect((await admin.req("GET", `/api/reservas?de=${hoje}&ate=${dias(3)}&busca=%25`)).json().total).toBe(0);
    const pag = (await admin.req("GET", `/api/reservas?de=${hoje}&ate=${dias(3)}&limite=3&pagina=2`)).json();
    expect(pag.reservas).toHaveLength(3);
    expect(pag.total).toBe(8);
  });

  it("entrada inválida volta 400; a consulta é auditada sem dados pessoais", async () => {
    expect((await admin.req("GET", "/api/reservas?canal=XYZ")).statusCode).toBe(400);
    expect((await admin.req("GET", "/api/reservas?limite=1000")).statusCode).toBe(400);
    expect((await admin.req("GET", `/api/reservas?de=${hoje}&ate=2099-01-01`)).statusCode).toBe(400);
    await admin.req("GET", `/api/reservas?de=${hoje}&ate=${dias(1)}&busca=Cliente`);
    const logs = await db.select().from(auditoria).where(eq(auditoria.acao, "RESERVAS_LISTADAS"));
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs.map((l) => l.dados))).not.toContain("Cliente");
  });
});

describe("valor da reserva manual (balcão)", () => {
  it("é opcional, em centavos inteiros, exige financeiro:ver e a alteração é auditada com antes e depois", async () => {
    const sid = await saida(passeioFln, dias(5));
    const corpo = { canal: "BALCAO", contatoNome: "Cliente Teste Manual", passageiros: [{ nome: "Pax Teste", categoria: "ADULTO" }] };
    const sem = await admin.req("POST", `/api/saidas/${sid}/reservas`, corpo);
    expect(sem.statusCode).toBe(200);
    expect(sem.json().vendaId).toBeUndefined();
    for (const ruim of [-1, 10.5, "100", 100_000_001]) expect((await admin.req("POST", `/api/saidas/${sid}/reservas`, { ...corpo, valorCentavos: ruim })).statusCode, String(ruim)).toBe(400);
    const atendente = new Cliente(app);
    await atendente.login("atendente@bybus.test");
    expect((await atendente.req("POST", `/api/saidas/${sid}/reservas`, { ...corpo, valorCentavos: 9000 })).json().codigo).toBe("SEM_PERMISSAO");
    expect((await atendente.req("POST", `/api/saidas/${sid}/reservas`, { ...corpo, contatoNome: "Cliente Teste Sem Valor" })).statusCode).toBe(200);

    const r = await admin.req("POST", `/api/saidas/${sid}/reservas`, { ...corpo, contatoNome: "Cliente Teste Com Valor", valorCentavos: 9000 });
    expect(r.json().valorCentavos).toBe(9000);
    const id = r.json().id as string;
    expect((await admin.req("PATCH", `/api/reservas/${id}`, { valorCentavos: 12050 })).json().valorCentavos).toBe(12050);
    expect((await atendente.req("PATCH", `/api/reservas/${id}`, { valorCentavos: 1 })).statusCode).toBe(403);
    const [log] = (await db.select().from(auditoria).where(eq(auditoria.entidadeId, id))).filter((l) => l.acao === "RESERVA_ALTERADA");
    expect(log!.dados).toMatchObject({ valorAntes: 9000, valorDepois: 12050 });
    // a lista da saída só mostra o valor a quem pode ver o financeiro
    const comoAdmin = (await admin.req("GET", `/api/saidas/${sid}/reservas`)).json();
    expect(comoAdmin.find((x: { id: string }) => x.id === id).valorCentavos).toBe(12050);
    const comoAtendente = (await atendente.req("GET", `/api/saidas/${sid}/reservas`)).json();
    expect(JSON.stringify(comoAtendente)).not.toContain("valorCentavos");
    expect(JSON.stringify(comoAtendente)).not.toContain("vendaId");
  });
});

describe("sincronização da Paytour grava os valores (idempotente, preenche reservas antigas)", () => {
  it("importa valor, canal de venda e compra; reimportar não duplica e completa a reserva já existente", async () => {
    const http = await import("node:http");
    let valor = "170.00";
    const pedido = () => ({
      id: "8801", status: "aprovado", cliente_nome: "Comprador Ficticio", cliente_email: "c@exemplo.com", data_hora_atualizacao: "2026-10-20 10:00:00",
      valor, desconto: "10.00", cupom_id: "415", metodo_pagamento: "cielo", parcelas_pagamento: 2, data_hora_pedido: "2026-10-20 09:47:39", operador_id: "48",
      afiliado_id: "null", pagamento_pendente: "1", pagamento_pendente_valor: "40.00", utm_source: "google", cliente_cidade: "Curitiba", cliente_uf: "PR",
      itens: [
        { id: "1", produto_tipo: "passeio", quantidade: "2", nome_produto: "City Tour Floripa - Toda Ilha", produto_disponibilidade_data: "2026-10-28", valor: "100.00", produto_faixa_etaria_nome: "Adulto" },
        { id: "2", produto_tipo: "passeio", quantidade: "1", nome_produto: "City Tour Floripa - Toda Ilha", produto_disponibilidade_data: "2026-10-29", valor: "60.00", produto_faixa_etaria_nome: "Adulto" },
      ],
    });
    const servidor = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/v2/lojas/login")) return res.end(JSON.stringify({ access_token: "tok-1", expires_in: Math.floor(Date.now() / 1000) + 3600 }));
      if (req.url?.startsWith("/v2/afiliados")) return res.end(JSON.stringify({ info: { total_paginas: 1 }, itens: [] }));
      if (req.url?.startsWith("/v2/pedidos")) return res.end(JSON.stringify({ info: { total: 1, pagina: 1, total_paginas: 1 }, itens: [pedido()] }));
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
    const porta = (servidor.address() as { port: number }).port;
    const comPaytour = await subirApp({ PAYTOUR_APP_KEY: "chave-app-teste", PAYTOUR_APP_SECRET: "segredo-app-teste", PAYTOUR_URL: `http://127.0.0.1:${porta}/v2`, PAYTOUR_SINCRONIZAR_MINUTOS: "0" });
    try {
      const c = new Cliente(comPaytour.app);
      await c.login("admin@bybus.test");
      expect((await c.req("POST", "/api/integracoes/paytour/sincronizar", {})).json().resumo).toMatchObject({ CRIAR: 2 });
      const dadosVenda = async () => ({
        v: await db.select().from(vendas).where(eq(vendas.pedidoCodigo, "PAYTOUR-8801")),
        r: (await db.select({ codigo: reservas.codigoExterno, valor: reservas.valorCentavos, desc: reservas.descontoCentavos }).from(reservas)).filter((x) => x.codigo?.startsWith("PAYTOUR-8801")),
      });
      let d = await dadosVenda();
      expect(d.v).toHaveLength(1);
      expect(d.v[0]).toMatchObject({ valorCentavos: 17000, descontoCentavos: 1000, canalVenda: "ADMIN", cupomExternoId: "415", parcelas: 2, pagamentoPendenteCentavos: 4000, utmSource: "google", clienteCidade: "Curitiba" });
      expect(d.v[0]!.dataHoraCompra!.toISOString()).toBe("2026-10-20T12:47:39.000Z");
      // 100,00 (2 pessoas) e 60,00 (1 pessoa): 170,00 rateado em 10625 + 6375
      expect(d.r.map((x) => x.valor).sort((a, b) => a! - b!)).toEqual([6375, 10625]);
      expect(d.r.reduce((t, x) => t + (x.valor ?? 0), 0)).toBe(17000);

      // Simula reservas "antigas" (importadas antes desta versão: sem valor nem pedido) e o pedido mudando de valor.
      await db.update(reservas).set({ valorCentavos: null, vendaId: null, descontoCentavos: 0 }).where(eq(reservas.contatoNome, reservas.contatoNome));
      await db.delete(vendas).where(eq(vendas.pedidoCodigo, "PAYTOUR-8801"));
      valor = "170.00";
      expect((await c.req("POST", "/api/integracoes/paytour/sincronizar", {})).json().resumo).toMatchObject({ ATUALIZAR: 2, CRIAR: 0 });
      d = await dadosVenda();
      expect(d.v).toHaveLength(1);
      expect(d.r.reduce((t, x) => t + (x.valor ?? 0), 0)).toBe(17000);
      // de novo: nada muda nem duplica
      await c.req("POST", "/api/integracoes/paytour/sincronizar", {});
      d = await dadosVenda();
      expect(d.v).toHaveLength(1);
      expect(d.r).toHaveLength(2);
    } finally {
      await comPaytour.fechar();
      servidor.close();
    }
  });
});

describe("Viator pelo e-mail da Bókun", () => {
  it("grava a venda (OTA) quando o e-mail traz o total em reais; reimportar atualiza sem duplicar", async () => {
    const corpo = (total: string) => `| Booking ref. | VIA-888000777 |
| Product | 165696P2 - Floripa City Tour by Bus - Whole Island |
| Sold by | Viator.com |
| Booking channel | Viator.com |
| Customer | Teste, Pessoa |
| Date | Sat 24.Oct '26 @ 08:00 |
| PAX | 2 Adult |
| Created | Wed, October 21 2026 @ 05:07 |
| Total price | ${total} |`;
    const a = new Cliente(app);
    await a.login("atendente@bybus.test");
    for (const total of ["BRL 480.00", "BRL 500.00"]) {
      expect((await a.req("POST", "/api/importacoes/bokun-email", { emails: [{ assunto: "New booking", corpo: corpo(total) }], confirmar: true })).statusCode).toBe(200);
    }
    const v = await db.select().from(vendas).where(eq(vendas.pedidoCodigo, "VIA-888000777"));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ canalVenda: "OTA", fonte: "BOKUN_EMAIL", valorCentavos: 50000 });
    const [r] = await db.select().from(reservas).where(eq(reservas.codigoExterno, "VIA-888000777"));
    expect(r).toMatchObject({ valorCentavos: 50000, vendaId: v[0]!.id });
  });
});
