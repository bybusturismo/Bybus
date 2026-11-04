import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { auditoria, checklistItens, passeios, perfis, saidas, unidades, usuarios, usuariosUnidades } from "../src/db/schema.js";
import { ITENS_CHECKLIST_PADRAO } from "@bybus/core";
import { aplicarEscalaNaSaida } from "../src/servicos/escala.js";
import { registrarLeituraKm } from "../src/servicos/frota.js";
import { SENHA_DEMO } from "../src/db/ficticios.js";
import { gerarHashSenha } from "../src/seguranca/senha.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
let FLN = "";
let BC = "";

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  // Motorista fictício: perfil só com o checklist, na praça de Florianópolis.
  const { db, pool } = criarDb(DATABASE_URL);
  const lista = await db.select().from(unidades);
  FLN = lista.find((u) => u.codigo === "FLN")!.id;
  BC = lista.find((u) => u.codigo === "BC")!.id;
  const [perfil] = await db.insert(perfis).values({ codigo: "MOTORISTA_FROTA", nome: "Motorista (frota)", permissoes: ["frota:checklist"] }).returning();
  const [u] = await db.insert(usuarios).values({ nome: "Motorista Fictício", email: "motorista.frota@bybus.test", perfilId: perfil!.id, senhaHash: await gerarHashSenha(SENHA_DEMO), trocarSenha: false }).returning();
  await db.insert(usuariosUnidades).values({ usuarioId: u!.id, unidadeId: FLN });
  await pool.end();
});
afterAll(async () => fechar());

async function logado(email: string) {
  const c = new Cliente(app);
  expect((await c.login(email)).statusCode).toBe(200);
  return c;
}

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const somar = (dias: number) => new Date(Date.parse(`${hoje()}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

async function criarVeiculo(c: Cliente, placa: string, extra: Record<string, unknown> = {}) {
  const r = await c.req("POST", "/api/frota/veiculos", { unidadeId: FLN, placa, tipo: "ONIBUS_DOIS_ANDARES", capacidade: 73, ano: 2012, apelido: "Fictício", kmAtual: 1000, ...extra });
  expect(r.statusCode, r.body).toBe(201);
  return r.json() as { id: string; placa: string };
}

describe("veículos e permissões", () => {
  it("cria com placa normalizada, recusa duplicada e inválida; supervisor sem permissão é barrado", async () => {
    const admin = await logado("admin@bybus.test");
    const v = await criarVeiculo(admin, "abc-1d23");
    expect(v.placa).toBe("ABC1D23");
    expect((await admin.req("POST", "/api/frota/veiculos", { unidadeId: FLN, placa: "ABC1D23", tipo: "VAN" })).statusCode).toBe(409);
    expect((await admin.req("POST", "/api/frota/veiculos", { unidadeId: FLN, placa: "XX", tipo: "VAN" })).statusCode).toBe(400);
    const sup = await logado("supervisor@bybus.test");
    expect((await sup.req("GET", "/api/frota/veiculos")).statusCode).toBe(403);
    expect((await sup.req("POST", "/api/frota/veiculos", { unidadeId: FLN, placa: "ZZZ9Z99", tipo: "VAN" })).statusCode).toBe(403);
    const { db, pool } = criarDb(DATABASE_URL);
    const [a] = await db.select().from(auditoria).where(eq(auditoria.acao, "VEICULO_CRIADO"));
    await pool.end();
    expect(a).toBeTruthy();
  });

  it("km só sobe e a praça limita o acesso", async () => {
    const admin = await logado("admin@bybus.test");
    const v = await criarVeiculo(admin, "KMK1A11");
    expect((await admin.req("POST", "/api/frota/leituras-km", { veiculoId: v.id, km: 1500 })).statusCode).toBe(201);
    const menor = await admin.req("POST", "/api/frota/leituras-km", { veiculoId: v.id, km: 1200 });
    expect(menor.statusCode).toBe(409);
    expect(menor.json().codigo).toBe("KM_MENOR");
    expect((await admin.req("POST", "/api/frota/leituras-km", { veiculoId: v.id, km: 1600, fonte: "KHRONOS" })).statusCode).toBe(400);
    expect((await admin.req("GET", `/api/frota/veiculos/${v.id}`)).json().kmAtual).toBe(1500);
    // Veículo de outra praça não aparece para quem só tem Florianópolis (motorista só com checklist enxerga FLN).
    const bc = await criarVeiculo(admin, "BCB1A11", { unidadeId: BC });
    const mot = await logado("motorista.frota@bybus.test");
    const lista = (await mot.req("GET", "/api/frota/checklist/veiculos")).json() as Array<{ id: string }>;
    expect(lista.some((x) => x.id === bc.id)).toBe(false);
    expect(lista.some((x) => x.id === v.id)).toBe(true);
    expect((await mot.req("POST", "/api/frota/checklists", { veiculoId: bc.id, respostas: [{ itemId: v.id, ok: true }] })).statusCode).toBe(404);
  });
});

describe("documentos e bloqueio", () => {
  it("alerta 30 dias antes, vencido bloqueia o veículo e aparece em opções/disponibilidade", async () => {
    const admin = await logado("admin@bybus.test");
    const v = await criarVeiculo(admin, "DOC1A11");
    const d1 = await admin.req("POST", "/api/frota/documentos", { veiculoId: v.id, tipo: "CRLV", vencimento: somar(20) });
    const d2 = await admin.req("POST", "/api/frota/documentos", { veiculoId: v.id, tipo: "SEGURO", descricao: "Apólice fictícia", vencimento: somar(200) });
    expect(d1.statusCode).toBe(201);
    expect(d2.statusCode).toBe(201);
    let docs = (await admin.req("GET", `/api/frota/documentos?veiculoId=${v.id}`)).json() as Array<{ tipo: string; situacao: string }>;
    expect(docs.map((d) => [d.tipo, d.situacao])).toEqual([["CRLV", "A_VENCER"], ["SEGURO", "EM_DIA"]]);
    expect((await admin.req("GET", `/api/frota/disponibilidade/DOC1A11`)).json().disponivel).toBe(true);

    await admin.req("PATCH", `/api/frota/documentos/${(d1.json() as { id: string }).id}`, { vencimento: somar(-1) });
    docs = (await admin.req("GET", `/api/frota/documentos?situacao=VENCIDO`)).json();
    expect(docs.some((d) => d.tipo === "CRLV")).toBe(true);
    const disp = (await admin.req("GET", `/api/frota/disponibilidade/doc1a11`)).json();
    expect(disp).toMatchObject({ disponivel: false, motivosBloqueio: ["Documento vencido: CRLV"] });
    const opcoes = (await admin.req("GET", "/api/frota/veiculos/opcoes")).json() as Array<{ placa: string; disponivel: boolean }>;
    expect(opcoes.find((o) => o.placa === "DOC1A11")?.disponivel).toBe(false);
    // Quem monta saídas (supervisor) consegue consultar as opções sem acesso ao módulo.
    const sup = await logado("supervisor@bybus.test");
    expect((await sup.req("GET", "/api/frota/veiculos/opcoes")).statusCode).toBe(200);
  });
});

describe("planos e ordens de manutenção", () => {
  it("plano crítico vencido bloqueia; concluir a preventiva zera o plano, soma custo e sobe o km", async () => {
    const admin = await logado("admin@bybus.test");
    const v = await criarVeiculo(admin, "MAN1A11", { kmAtual: 50_000 });
    expect((await admin.req("POST", "/api/frota/planos", { veiculoId: v.id, nome: "Sem intervalo" })).statusCode).toBe(400);
    const p = await admin.req("POST", "/api/frota/planos", { veiculoId: v.id, nome: "Troca de óleo", intervaloKm: 10_000, ultimoKm: 38_000, critico: true });
    expect(p.statusCode).toBe(201);
    const planos = (await admin.req("GET", `/api/frota/planos?veiculoId=${v.id}`)).json() as Array<{ situacao: string; kmRestante: number }>;
    expect(planos[0]).toMatchObject({ situacao: "VENCIDA", kmRestante: -2000 });
    expect((await admin.req("GET", "/api/frota/disponibilidade/MAN1A11")).json().motivosBloqueio).toEqual(["Manutenção crítica vencida: Troca de óleo"]);

    const o = await admin.req("POST", "/api/frota/ordens", { veiculoId: v.id, planoId: (p.json() as { id: string }).id, tipo: "PREVENTIVA", descricao: "Troca de óleo e filtros", oficina: "Oficina Fictícia", imobiliza: true, abertaEm: somar(-2) });
    expect(o.statusCode).toBe(201);
    expect((await admin.req("GET", `/api/frota/veiculos/${v.id}`)).json().situacao).toBe("MANUTENCAO");
    const id = (o.json() as { id: string }).id;
    const fim = await admin.req("PATCH", `/api/frota/ordens/${id}`, { status: "CONCLUIDA", custoCentavos: 123_456, km: 50_400 });
    expect(fim.statusCode, fim.body).toBe(200);
    const veiculo = (await admin.req("GET", `/api/frota/veiculos/${v.id}`)).json();
    expect(veiculo).toMatchObject({ situacao: "ATIVO", kmAtual: 50_400, disponivel: true });
    const plano = (await admin.req("GET", `/api/frota/planos?veiculoId=${v.id}`)).json()[0];
    expect(plano).toMatchObject({ ultimoKm: 50_400, situacao: "EM_DIA", ultimaData: hoje() });
    const ordens = (await admin.req("GET", `/api/frota/ordens?veiculoId=${v.id}`)).json();
    expect(ordens[0]).toMatchObject({ status: "CONCLUIDA", custoCentavos: 123_456, diasParado: 2 });
    expect((await admin.req("PATCH", `/api/frota/ordens/${id}`, { descricao: "mudar depois de encerrada" })).statusCode).toBe(409);
    expect((await admin.req("POST", "/api/frota/ordens", { veiculoId: v.id, planoId: "00000000-0000-4000-8000-000000000000", tipo: "PREVENTIVA", descricao: "x y z" })).statusCode).toBe(400);
  });
});

describe("abastecimento e consumo", () => {
  it("calcula km/l entre tanques cheios e alerta consumo fora da média", async () => {
    const admin = await logado("admin@bybus.test");
    const v = await criarVeiculo(admin, "ABA1A11", { kmAtual: 0 });
    const lancar = (km: number, litros: number, dias: number, extra: Record<string, unknown> = {}) =>
      admin.req("POST", "/api/frota/abastecimentos", { veiculoId: v.id, data: somar(dias), km, litros, valorCentavos: Math.round(litros * 600), posto: "Posto Fictício", ...extra });
    expect((await lancar(1000, 100, -20)).statusCode).toBe(201);
    for (const [km, l, d] of [[1250, 100, -15], [1500, 100, -10], [1750, 100, -5]] as const) expect((await lancar(km, l, d)).statusCode).toBe(201); // 2,5 km/l
    expect((await lancar(1750, 50, -4)).statusCode).toBe(409); // km repetido
    const ruim = await lancar(1900, 100, -1); // 150 km com 100 l = 1,5 km/l
    expect(ruim.statusCode).toBe(201);
    expect(ruim.json()).toMatchObject({ kml: 1.5, alerta: "ALTO" });
    const r = (await admin.req("GET", `/api/frota/abastecimentos?veiculoId=${v.id}`)).json();
    expect(r.itens[0]).toMatchObject({ km: 1900, kml: 1.5, alerta: "ALTO", placa: "ABA1A11" });
    expect(r.resumo[0]).toMatchObject({ litros: 500, valorCentavos: 300_000, alertas: 1 });
    expect((await admin.req("GET", `/api/frota/veiculos/${v.id}`)).json().kmAtual).toBe(1900);
    const painel = (await admin.req("GET", "/api/frota/painel")).json();
    expect(painel.alertasConsumo.some((a: { placa: string }) => a.placa === "ABA1A11")).toBe(true);
  });
});

describe("checklist diário", () => {
  it("motorista preenche; item crítico com problema abre ordem corretiva e bloqueia o veículo", async () => {
    const admin = await logado("admin@bybus.test");
    const v = await criarVeiculo(admin, "CHK1A11", { kmAtual: 2000 });
    const mot = await logado("motorista.frota@bybus.test");
    expect((await mot.req("GET", "/api/frota/veiculos")).statusCode).toBe(403); // só checklist
    const itens = (await mot.req("GET", "/api/frota/checklist/itens")).json() as Array<{ id: string; descricao: string; critico: boolean }>;
    expect(itens.length).toBeGreaterThan(10);
    const todosOk = itens.map((i) => ({ itemId: i.id, ok: true }));

    const bom = await mot.req("POST", "/api/frota/checklists", { veiculoId: v.id, km: 2050, respostas: todosOk });
    expect(bom.statusCode, bom.body).toBe(201);
    expect(bom.json()).toMatchObject({ aprovado: true, veiculoBloqueado: false });
    expect((await mot.req("POST", "/api/frota/checklists", { veiculoId: v.id, km: 2000, respostas: todosOk })).json().codigo).toBe("KM_MENOR");
    expect((await mot.req("POST", "/api/frota/checklists", { veiculoId: v.id, respostas: todosOk.slice(1) })).json().codigo).toBe("ITENS_FALTANDO");

    const critico = itens.find((i) => i.critico)!;
    const semObs = todosOk.map((r) => (r.itemId === critico.id ? { ...r, ok: false } : r));
    expect((await mot.req("POST", "/api/frota/checklists", { veiculoId: v.id, respostas: semObs })).json().codigo).toBe("OBSERVACAO_OBRIGATORIA");
    const ruim = await mot.req("POST", "/api/frota/checklists", { veiculoId: v.id, observacao: "Fictício", respostas: semObs.map((r) => (r.itemId === critico.id ? { ...r, observacao: "Vazamento visível" } : r)) });
    expect(ruim.statusCode, ruim.body).toBe(201);
    expect(ruim.json()).toMatchObject({ aprovado: false, veiculoBloqueado: true });
    const veic = (await admin.req("GET", `/api/frota/veiculos/${v.id}`)).json();
    expect(veic).toMatchObject({ situacao: "MANUTENCAO", disponivel: false });
    expect(veic.ordensAbertas[0]).toMatchObject({ tipo: "CORRETIVA", imobiliza: true });

    const hist = (await admin.req("GET", `/api/frota/checklists?veiculoId=${v.id}&somenteProblemas=true`)).json();
    expect(hist).toHaveLength(1);
    expect(hist[0].resumo).toMatchObject({ aprovado: false, criticosNaoOk: 1 });
    const lista = (await mot.req("GET", "/api/frota/checklist/veiculos")).json() as Array<{ id: string; feitoHoje: boolean; aprovadoHoje: boolean }>;
    expect(lista.find((x) => x.id === v.id)).toMatchObject({ feitoHoje: true, aprovadoHoje: false });
  });

  it("itens são configuráveis por quem gerencia", async () => {
    const admin = await logado("admin@bybus.test");
    const novo = await admin.req("POST", "/api/frota/checklist/itens", { grupo: "Interior", descricao: "Item fictício extra", critico: false });
    expect(novo.statusCode).toBe(201);
    const id = (novo.json() as { id: string }).id;
    expect((await admin.req("PATCH", `/api/frota/checklist/itens/${id}`, { ativo: false })).statusCode).toBe(200);
    const ativos = (await admin.req("GET", "/api/frota/checklist/itens")).json() as Array<{ id: string }>;
    expect(ativos.some((i) => i.id === id)).toBe(false);
    const mot = await logado("motorista.frota@bybus.test");
    expect((await mot.req("POST", "/api/frota/checklist/itens", { grupo: "Interior", descricao: "Não pode" })).statusCode).toBe(403);
  });
});

describe("painel", () => {
  it("resume disponibilidade, vencimentos, manutenções e custos do mês", async () => {
    const admin = await logado("admin@bybus.test");
    const pnl = await criarVeiculo(admin, "PNL1A11", { kmAtual: 9500 });
    await admin.req("POST", "/api/frota/planos", { veiculoId: pnl.id, nome: "Revisão geral", intervaloKm: 10_000, ultimoKm: 0 });
    const r = await admin.req("GET", "/api/frota/painel");
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json();
    expect(p.disponibilidade.total).toBeGreaterThan(3);
    expect(p.disponibilidade.indisponiveis.length).toBeGreaterThan(0);
    expect(p.vencimentosTotais.vencidos).toBeGreaterThan(0);
    expect(p.manutencoes[0]).toMatchObject({ placa: "PNL1A11", situacao: "PROXIMA", kmRestante: 500 });
    const man = p.custos.find((c: { placa: string }) => c.placa === "MAN1A11");
    expect(man).toMatchObject({ manutencaoCentavos: 123_456, kmRodados: 400 });
    expect(man.custoPorKmCentavos).toBe(Math.round(123_456 / 400));
    expect((await admin.req("GET", "/api/frota/painel?mes=2026-13")).statusCode).toBe(400);
  });
});

describe("regressões de concorrência e bloqueio no back-end", () => {
  it("leituras de km concorrentes nunca baixam o km", async () => {
    const admin = await logado("admin@bybus.test");
    const v = await criarVeiculo(admin, "CON1A11", { kmAtual: 100 });
    const { db, pool } = criarDb(DATABASE_URL);
    const kms = [900, 300, 700, 500, 1000, 200, 800, 400, 600, 150];
    await Promise.all(kms.map((km) => registrarLeituraKm(db, { veiculoId: v.id, km, data: hoje(), fonte: "KHRONOS" })));
    await pool.end();
    expect((await admin.req("GET", `/api/frota/veiculos/${v.id}`)).json().kmAtual).toBe(1000);
  });

  it("primeiras chamadas simultâneas não duplicam os itens do checklist", async () => {
    const admin = await logado("admin@bybus.test");
    const { db, pool } = criarDb(DATABASE_URL);
    await db.delete(checklistItens);
    const rs = await Promise.all(Array.from({ length: 6 }, () => admin.req("GET", "/api/frota/checklist/itens")));
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    const total = await db.select().from(checklistItens);
    await pool.end();
    expect(total).toHaveLength(ITENS_CHECKLIST_PADRAO.length);
  });

  it("escala recusa veículo padrão indisponível, aceita placa fora da frota e a saída não copia indisponível", async () => {
    const admin = await logado("admin@bybus.test");
    const v = await criarVeiculo(admin, "ESC1A11");
    await admin.req("POST", "/api/frota/documentos", { veiculoId: v.id, tipo: "CRLV", vencimento: somar(-3) });
    const toda = (await admin.req("GET", "/api/passeios")).json().find((p: { codigo: string }) => p.codigo === "TODA_ILHA");
    const put = (veiculoPadrao: string) => admin.req("PUT", "/api/escala", { passeioId: toda.id, mes: "2031-01", dias: [], veiculoPadrao });
    const recusa = await put("esc-1a11");
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json().codigo).toBe("VEICULO_INDISPONIVEL");
    expect(recusa.json().mensagem).toContain("Documento vencido: CRLV");
    expect((await put("ZZZ9Z99")).statusCode).toBe(200); // fora da frota: aceito

    const { db, pool } = criarDb(DATABASE_URL);
    await db.update(passeios).set({ veiculoPadrao: "ESC1A11" }).where(eq(passeios.id, toda.id));
    const [s] = await db.insert(saidas).values({ passeioId: toda.id, data: "2031-01-10", capacidade: 10 }).returning();
    await aplicarEscalaNaSaida(db, toda.id, "2031-01-10", false);
    const [depois] = await db.select().from(saidas).where(eq(saidas.id, s!.id));
    await db.update(passeios).set({ veiculoPadrao: "ZZZ9Z99" }).where(eq(passeios.id, toda.id));
    await aplicarEscalaNaSaida(db, toda.id, "2031-01-10", false);
    const [livre] = await db.select().from(saidas).where(eq(saidas.id, s!.id));
    await pool.end();
    expect(depois!.veiculo).toBeNull();
    expect(livre!.veiculo).toBe("ZZZ9Z99");
  });
});
