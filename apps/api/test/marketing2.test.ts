import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { lerConfig } from "../src/config.js";
import { criarDb } from "../src/db/cliente.js";
import { auditoria, avaliacaoPedidos, bioCliques, campanhas, mensagens, npsRespostas, orcamentosGrupo, passageiros, passeios, relatoriosMarketing, reservas, saidas, vendas } from "../src/db/schema.js";
import { definirClienteIA } from "../src/servicos/ia/cliente.js";
import { criarNps, rodarMensagensAutomaticas } from "../src/servicos/mensagensAuto.js";
import { rodarRotinasMarketing } from "../src/servicos/rotinasMarketing.js";
import { hojeSp, somarDias } from "../src/servicos/marketingComum.js";
import { Cliente, CHAVE, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
let admin: Cliente;
let gestor: Cliente; // marketing:ver + gerenciar, praça FLN
let leitor: Cliente; // marketing:ver, praça FLN
let atendente: Cliente; // reservas:editar (sem manifesto:contatos), praça FLN
let semAcesso: Cliente;
let supBc: Cliente; // marketing:ver + gerenciar, praça BC
let flnId = "";
let bcId = "";
let passeioFln = "";
const { db, pool } = criarDb(DATABASE_URL);
const config = lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: CHAVE, EXIGIR_MFA_ADMIN: "false", URL_PUBLICA: "https://app.bybus.test" });
const logFalso = { error: () => {}, info: () => {} };
const hoje = hojeSp();
const dia = (n: number) => somarDias(hoje, n);

async function novoUsuario(perfil: string, permissoes: string[], email: string, unidadeIds: string[]) {
  expect((await admin.req("POST", "/api/perfis", { codigo: perfil, nome: perfil, permissoes })).statusCode).toBe(200);
  const { senhaTemporaria } = (await admin.req("POST", "/api/usuarios", { nome: `Usuário ${perfil}`, email, perfil, unidadeIds })).json();
  const c = new Cliente(app);
  await c.login(email, senhaTemporaria);
  await c.req("POST", "/api/auth/senha", { senhaAtual: senhaTemporaria, novaSenha: "Mkt2Teste123456" });
  return c;
}

/** Saída no passado (ou futuro) com uma reserva fictícia e um passageiro. */
async function reservaFicticia(o: { data: string; codigo: string; telefone?: string | null; canal?: "PAYTOUR" | "VIATOR"; origemCliente?: string | null; nome?: string; valor?: number | null; vendaId?: string | null; passeioId?: string; embarque?: "EMBARCOU" | "NO_SHOW"; criadoEm?: Date }) {
  const pid = o.passeioId ?? passeioFln;
  let [saida] = await db.select().from(saidas).where(eq(saidas.passeioId, pid));
  const existentes = await db.select().from(saidas).where(eq(saidas.passeioId, pid));
  saida = existentes.find((s) => s.data === o.data);
  if (!saida) [saida] = await db.insert(saidas).values({ passeioId: pid, data: o.data, capacidade: 73 }).returning();
  const [r] = await db.insert(reservas).values({
    saidaId: saida!.id, canal: o.canal ?? "PAYTOUR", canalOrigem: o.canal ?? "PAYTOUR", codigoExterno: o.codigo, contatoNome: o.nome ?? "Maria Fictícia Teste",
    contatoTelefone: o.telefone === undefined ? "+55 48 90000-0001" : o.telefone, origemCliente: o.origemCliente ?? null, valorCentavos: o.valor ?? null, vendaId: o.vendaId ?? null,
    ...(o.criadoEm ? { criadoEm: o.criadoEm } : {}),
  }).returning();
  await db.insert(passageiros).values({ reservaId: r!.id, nome: "Passageira Fictícia", categoria: "ADULTO", embarque: o.embarque ?? "EMBARCOU" });
  return { reservaId: r!.id, saidaId: saida!.id };
}

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ URL_PUBLICA: "https://app.bybus.test" }));
  admin = new Cliente(app);
  expect((await admin.login("admin@bybus.test")).statusCode).toBe(200);
  const un = (await admin.req("GET", "/api/unidades")).json() as Array<{ id: string; codigo: string }>;
  flnId = un.find((u) => u.codigo === "FLN")!.id;
  bcId = un.find((u) => u.codigo === "BC")!.id;
  [{ id: passeioFln }] = await db.select({ id: passeios.id }).from(passeios).where(eq(passeios.unidadeId, flnId)).limit(1) as [{ id: string }];
  gestor = await novoUsuario("M2_GESTOR", ["marketing:ver", "marketing:gerenciar"], "m2.gestor@bybus.test", [flnId]);
  leitor = await novoUsuario("M2_LEITOR", ["marketing:ver"], "m2.leitor@bybus.test", [flnId]);
  atendente = await novoUsuario("M2_ATEND", ["reservas:editar", "manifesto:ver"], "m2.atend@bybus.test", [flnId]);
  semAcesso = await novoUsuario("M2_SEM", ["manifesto:ver"], "m2.sem@bybus.test", [flnId]);
  supBc = await novoUsuario("M2_BC", ["marketing:ver", "marketing:gerenciar"], "m2.bc@bybus.test", [bcId]);
});
afterAll(async () => {
  definirClienteIA(null);
  await pool.end();
  await fechar();
});

describe("permissões do marketing 2", () => {
  it("sem login ou sem permissão não acessa as telas internas", async () => {
    const anon = new Cliente(app);
    for (const u of ["/api/marketing/retorno", "/api/marketing/relatorios", "/api/marketing/bio", "/api/marketing/nps", "/api/marketing/mensagens", "/api/marketing/avaliacoes/config", "/api/orcamentos", "/api/marketing/avisos"]) {
      expect((await anon.req("GET", u)).statusCode, u).toBe(401);
    }
    for (const u of ["/api/marketing/retorno", "/api/marketing/relatorios", "/api/marketing/bio", "/api/marketing/nps", "/api/marketing/mensagens", "/api/orcamentos"]) {
      expect((await semAcesso.req("GET", u)).statusCode, u).toBe(403);
    }
    expect((await leitor.req("GET", "/api/orcamentos")).statusCode).toBe(403); // marketing não dá acesso aos orçamentos
    expect((await atendente.req("GET", "/api/marketing/nps")).statusCode).toBe(403);
  });
  it("quem só vê não grava", async () => {
    expect((await leitor.req("POST", "/api/marketing/relatorios/gerar", { tipo: "SEMANAL" })).statusCode).toBe(403);
    expect((await leitor.req("PATCH", "/api/marketing/bio/config", { titulo: "x" })).statusCode).toBe(403);
    expect((await leitor.req("PATCH", "/api/marketing/mensagens/COMPRA", { ligado: true })).statusCode).toBe(403);
    expect((await leitor.req("POST", "/api/marketing/avaliacoes/externas", { canal: "GOOGLE", nota: 4.5, quantidade: 10 })).statusCode).toBe(403);
    expect((await leitor.req("POST", "/api/marketing/links", { origem: "a", midia: "b", campanha: "c" })).statusCode).toBe(200); // gerar link não grava nada
  });
  it("avisos da Visão Geral respeitam as permissões", async () => {
    expect((await semAcesso.req("GET", "/api/marketing/avisos")).json()).toEqual({ orcamentosNovos: 0, casosNpsAbertos: 0 });
  });
});

describe("avaliações: fila, idioma, canal, envio simulado e painel", () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    ids.pt = (await reservaFicticia({ data: dia(-2), codigo: "M2-AV-PT", telefone: "48 90000-0010", nome: "Ana Exemplo Silva" })).reservaId;
    ids.en = (await reservaFicticia({ data: dia(-2), codigo: "M2-AV-EN", telefone: "+1 415 555 0100", nome: "John Sample Doe" })).reservaId;
    ids.es = (await reservaFicticia({ data: dia(-2), codigo: "M2-AV-ES", telefone: "+55 48 90000-0012", origemCliente: "Argentina", nome: "Lucía Prueba" })).reservaId;
    ids.via = (await reservaFicticia({ data: dia(-2), codigo: "M2-AV-VIA", telefone: "+1 212 555 0101", canal: "VIATOR", nome: "Bob Viator" })).reservaId;
    ids.sem = (await reservaFicticia({ data: dia(-2), codigo: "M2-AV-SEM", telefone: null })).reservaId;
    ids.nosh = (await reservaFicticia({ data: dia(-2), codigo: "M2-AV-NS", embarque: "NO_SHOW" })).reservaId;
  });

  it("configura os links por praça e os modelos por idioma (só quem tem a praça)", async () => {
    expect((await supBc.req("PATCH", "/api/marketing/avaliacoes/config", { linksGoogle: [{ unidadeId: flnId, link: "https://g.page/r/fln-teste" }] })).statusCode).toBe(404);
    expect((await gestor.req("PATCH", "/api/marketing/avaliacoes/config", { linksGoogle: [{ unidadeId: flnId, link: "http://inseguro.test" }] })).statusCode).toBe(400);
    const r = await gestor.req("PATCH", "/api/marketing/avaliacoes/config", { linksGoogle: [{ unidadeId: flnId, link: "https://g.page/r/fln-teste" }], linkTripadvisor: "https://tripadvisor.exemplo.test/bybus" });
    expect(r.statusCode).toBe(200);
    expect(r.json().linksGoogle.find((l: { unidadeId: string }) => l.unidadeId === flnId).link).toBe("https://g.page/r/fln-teste");
    expect(r.json().envio.real).toBe(false);
  });

  it("gera a fila no idioma do cliente, com o link do canal certo e sem tocar em quem não veio", async () => {
    const g = (await gestor.req("POST", "/api/marketing/avaliacoes/pedidos/gerar", { de: dia(-3), ate: dia(-1) })).json();
    expect(g.criados).toBe(5); // sem o NO_SHOW
    const lista = (await gestor.req("GET", `/api/marketing/avaliacoes/pedidos?de=${dia(-3)}&ate=${dia(-1)}`)).json() as Array<{ reservaId: string; idioma: string; canalAvaliacao: string; texto: string; link: string | null; status: string; temTelefone: boolean }>;
    const por = (id: string) => lista.find((p) => p.reservaId === id)!;
    expect(por(ids.pt!)).toMatchObject({ idioma: "pt", canalAvaliacao: "GOOGLE", link: "https://g.page/r/fln-teste", status: "PENDENTE" });
    expect(por(ids.pt!).texto).toContain("Olá, Ana!");
    expect(por(ids.en!)).toMatchObject({ idioma: "en" });
    expect(por(ids.en!).texto).toContain("Hi John!");
    expect(por(ids.es!)).toMatchObject({ idioma: "es" });
    expect(por(ids.es!).texto).toContain("¡Hola, Lucía!");
    expect(por(ids.via!)).toMatchObject({ idioma: "en", canalAvaliacao: "VIATOR", link: null });
    expect(por(ids.via!).texto).toContain("Viator");
    expect(por(ids.via!).texto).not.toContain("g.page");
    expect(por(ids.sem!)).toMatchObject({ status: "SEM_TELEFONE", temTelefone: false });
    expect(lista.find((p) => p.reservaId === ids.nosh)).toBeUndefined();
    expect(JSON.stringify(lista)).not.toMatch(/90000|555 0100|Silva|Doe/); // telefone e sobrenome nunca saem
  });

  it("edita idioma, canal e texto; Viator não troca de canal", async () => {
    const lista = (await gestor.req("GET", `/api/marketing/avaliacoes/pedidos?de=${dia(-3)}&ate=${dia(-1)}`)).json() as Array<{ id: string; reservaId: string }>;
    const pt = lista.find((p) => p.reservaId === ids.pt)!, via = lista.find((p) => p.reservaId === ids.via)!;
    expect((await leitor.req("PATCH", `/api/marketing/avaliacoes/pedidos/${pt.id}`, { idioma: "en" })).statusCode).toBe(403);
    expect((await gestor.req("PATCH", `/api/marketing/avaliacoes/pedidos/${pt.id}`, { idioma: "en", canalAvaliacao: "TRIPADVISOR" })).statusCode).toBe(200);
    let p = (await gestor.req("GET", `/api/marketing/avaliacoes/pedidos?de=${dia(-3)}&ate=${dia(-1)}`)).json().find((x: { id: string }) => x.id === pt.id);
    expect(p).toMatchObject({ idioma: "en", canalAvaliacao: "TRIPADVISOR", link: "https://tripadvisor.exemplo.test/bybus" });
    expect(p.texto).toContain("Hi Ana!");
    expect((await gestor.req("PATCH", `/api/marketing/avaliacoes/pedidos/${pt.id}`, { texto: "Mensagem editada à mão para {nome}" })).statusCode).toBe(200);
    p = (await gestor.req("GET", `/api/marketing/avaliacoes/pedidos?de=${dia(-3)}&ate=${dia(-1)}`)).json().find((x: { id: string }) => x.id === pt.id);
    expect(p.texto).toBe("Mensagem editada à mão para {nome}");
    expect((await gestor.req("PATCH", `/api/marketing/avaliacoes/pedidos/${via.id}`, { canalAvaliacao: "GOOGLE" })).statusCode).toBe(400);
    expect((await gestor.req("PATCH", `/api/marketing/avaliacoes/pedidos/${pt.id}`, { status: "SIMULADA" })).statusCode).toBe(400); // só o envio simula
    expect((await supBc.req("PATCH", `/api/marketing/avaliacoes/pedidos/${pt.id}`, { status: "IGNORADA" })).statusCode).toBe(404);
  });

  it("envia em modo simulado: nada sai, vira Simulada, não repete e o lembrete só depois", async () => {
    const lista = (await gestor.req("GET", `/api/marketing/avaliacoes/pedidos?de=${dia(-3)}&ate=${dia(-1)}`)).json() as Array<{ id: string; reservaId: string }>;
    const en = lista.find((p) => p.reservaId === ids.en)!, sem = lista.find((p) => p.reservaId === ids.sem)!;
    expect((await gestor.req("POST", `/api/marketing/avaliacoes/pedidos/${en.id}/enviar`, { lembrete: true })).statusCode).toBe(409); // lembrete antes do pedido
    const e = await gestor.req("POST", `/api/marketing/avaliacoes/pedidos/${en.id}/enviar`, {});
    expect(e.statusCode).toBe(200);
    expect(e.json()).toMatchObject({ status: "SIMULADA", simulado: true });
    const [m] = await db.select().from(mensagens).where(eq(mensagens.reservaId, ids.en!));
    expect(m).toMatchObject({ tipo: "AVALIACAO", status: "SIMULADA", provedor: "simulado" });
    expect((await gestor.req("POST", `/api/marketing/avaliacoes/pedidos/${en.id}/enviar`, {})).statusCode).toBe(409);
    expect((await gestor.req("POST", `/api/marketing/avaliacoes/pedidos/${sem.id}/enviar`, {})).statusCode).toBe(400);
    // lembrete: ainda não é devido (7 dias), mas pode ser enviado à mão
    const antes = (await gestor.req("GET", `/api/marketing/avaliacoes/pedidos?de=${dia(-3)}&ate=${dia(-1)}`)).json().find((x: { id: string }) => x.id === en.id);
    expect(antes.lembreteSugerido).toBe(false);
    await db.update(avaliacaoPedidos).set({ pedidoEm: new Date(Date.now() - 8 * 86_400_000) }).where(eq(avaliacaoPedidos.id, en.id));
    const depois = (await gestor.req("GET", `/api/marketing/avaliacoes/pedidos?de=${dia(-3)}&ate=${dia(-1)}`)).json().find((x: { id: string }) => x.id === en.id);
    expect(depois.lembreteSugerido).toBe(true);
    expect((await gestor.req("POST", `/api/marketing/avaliacoes/pedidos/${en.id}/enviar`, { lembrete: true })).json().status).toBe("LEMBRADA");
    expect((await gestor.req("POST", `/api/marketing/avaliacoes/pedidos/${en.id}/enviar`, { lembrete: true })).statusCode).toBe(409);
    expect((await gestor.req("PATCH", `/api/marketing/avaliacoes/pedidos/${en.id}`, { status: "AVALIADA" })).statusCode).toBe(200);
  });

  it("envio em lote e painel: funil, taxa de pedidos e evolução semanal", async () => {
    const l = (await gestor.req("POST", "/api/marketing/avaliacoes/pedidos/enviar-pendentes", { de: dia(-3), ate: dia(-1) })).json();
    expect(l).toMatchObject({ enviados: 3, falhas: 0, simulado: true }); // pt, es e Viator; "sem telefone" fica de fora
    const r = (await leitor.req("GET", `/api/marketing/avaliacoes/resumo?de=${dia(-3)}&ate=${dia(-1)}`)).json();
    expect(r.funil).toMatchObject({ elegiveis: 5, feitos: 4, avaliados: 1 });
    expect(r.funil.taxaPedidos).toBe(80);
    expect(r.funil.taxaAvaliacao).toBe(25);
    expect(r.pedidos).toMatchObject({ SIMULADA: 3, AVALIADA: 1, SEM_TELEFONE: 1 });
    expect(r.semanal.reduce((s: number, x: { pedidos: number }) => s + x.pedidos, 0)).toBe(5);
    expect(JSON.stringify(r)).not.toMatch(/90000|Maria/);
  });

  it("lança nota e quantidade por canal e por concorrente, uma por semana, com escopo de praça", async () => {
    const hojeLanc = { data: hoje, canal: "GOOGLE", nota: 4.78, quantidade: 321, unidadeId: flnId };
    expect((await supBc.req("POST", "/api/marketing/avaliacoes/externas", hojeLanc)).statusCode).toBe(403);
    expect((await gestor.req("POST", "/api/marketing/avaliacoes/externas", { ...hojeLanc, nota: 5.5 })).statusCode).toBe(400);
    expect((await gestor.req("POST", "/api/marketing/avaliacoes/externas", { ...hojeLanc, nota: 4.789 })).statusCode).toBe(400);
    expect((await gestor.req("POST", "/api/marketing/avaliacoes/externas", { data: hoje, canal: "GOOGLE", nota: 4, quantidade: 5 })).statusCode).toBe(403); // sem praça = todas as praças
    const a = (await gestor.req("POST", "/api/marketing/avaliacoes/externas", hojeLanc)).json();
    expect(a.notaCentesimos).toBe(478);
    const b = (await gestor.req("POST", "/api/marketing/avaliacoes/externas", { ...hojeLanc, nota: 4.8, quantidade: 330 })).json();
    expect(b.id).toBe(a.id); // mesma semana, canal e alvo: atualiza
    await gestor.req("POST", "/api/marketing/avaliacoes/externas", { ...hojeLanc, concorrente: "Concorrente Fictício", nota: 4.2, quantidade: 80 });
    const lista = (await leitor.req("GET", "/api/marketing/avaliacoes/externas")).json() as Array<{ alvo: string; notaCentesimos: number }>;
    expect(lista.map((x) => x.alvo).sort()).toEqual(["Concorrente Fictício", "PROPRIA"]);
    expect(lista.find((x) => x.alvo === "PROPRIA")!.notaCentesimos).toBe(480);
    expect((await supBc.req("GET", "/api/marketing/avaliacoes/externas")).json()).toEqual([]); // lançamento da praça FLN não aparece para BC
    expect((await supBc.req("DELETE", `/api/marketing/avaliacoes/externas/${a.id}`)).statusCode).toBe(404);
    expect((await gestor.req("DELETE", `/api/marketing/avaliacoes/externas/${a.id}`)).statusCode).toBe(200);
  });
});

describe("retorno de campanhas: UTM, cupom, afiliado e custo por CSV", () => {
  let campUtm = "", campCupom = "", afiliadoId = "";
  beforeAll(async () => {
    const nova = async (b: Record<string, unknown>) => (await gestor.req("POST", "/api/marketing/campanhas", { midia: "GOOGLE_ADS", inicio: dia(-10), investimentoCentavos: 100_000, unidadeId: flnId, ...b })).json().id as string;
    campUtm = await nova({ nome: "Ads Toda Ilha (teste)", utmCampanha: "ads-toda-ilha" });
    campCupom = await nova({ nome: "Cupom ILHA10 (teste)", midia: "INSTAGRAM", cupom: "ILHA10", investimentoCentavos: 50_000 });
    afiliadoId = (await gestor.req("POST", "/api/marketing/afiliados", { nome: "Hotel Retorno Fictício", codigo: "HOTEL-RET", unidadeId: flnId, paytourAfiliadoId: "777" })).json().id;
    const venda = async (cod: string, v: Partial<typeof vendas.$inferInsert>) => (await db.insert(vendas).values({ pedidoCodigo: cod, fonte: "PAYTOUR_API", canalVenda: "SITE", valorCentavos: 20_000, dataHoraCompra: new Date(), ...v }).returning())[0]!.id;
    const v1 = await venda("PAYTOUR-M2-1", { utmCampaign: "Ads-Toda-Ilha", utmSource: "google", valorCentavos: 30_000 });
    const v2 = await venda("PAYTOUR-M2-2", { cupomExternoId: "ilha10" });
    const v3 = await venda("PAYTOUR-M2-3", { utmCampaign: "campanha-que-nao-existe" });
    const v4 = await venda("PAYTOUR-M2-4", { afiliadoId: "777" });
    const v5 = await venda("PAYTOUR-M2-5", { utmCampaign: "ads-toda-ilha", dataHoraCompra: new Date(Date.now() - 40 * 86_400_000) }); // antes da campanha: não conta
    await reservaFicticia({ data: dia(5), codigo: "M2-RT-1", vendaId: v1, valor: 30_000 });
    await reservaFicticia({ data: dia(5), codigo: "M2-RT-2", vendaId: v2, valor: 20_000 });
    await reservaFicticia({ data: dia(5), codigo: "M2-RT-3", vendaId: v3, valor: 10_000 });
    await reservaFicticia({ data: dia(6), codigo: "M2-RT-4", vendaId: v4, valor: 15_000 });
    await reservaFicticia({ data: dia(6), codigo: "M2-RT-5", vendaId: v5, valor: 99_000 });
  });

  it("liga cada venda à campanha por UTM ou cupom, e ao afiliado pelo id da Paytour", async () => {
    const r = (await gestor.req("GET", "/api/marketing/retorno")).json();
    const utm = r.campanhas.find((c: { id: string }) => c.id === campUtm), cupom = r.campanhas.find((c: { id: string }) => c.id === campCupom);
    expect(utm).toMatchObject({ pedidos: 1, reservas: 1, receitaCentavos: 30_000, porUtm: 1, investimentoCentavos: 100_000, custoOrigem: "TOTAL_DA_CAMPANHA", custoPorReservaCentavos: 100_000, retorno: 0.3 });
    expect(cupom).toMatchObject({ reservas: 1, receitaCentavos: 20_000, porCupom: 1 });
    expect(r.afiliados.find((a: { id: string }) => a.id === afiliadoId)).toMatchObject({ reservas: 1, receitaCentavos: 15_000 });
    expect(r.semAtribuicao.pedidosComSinal).toBe(4); // v1..v4 (v5 é de antes do período)
    expect(r.semAtribuicao.semCampanhaNemAfiliado).toBe(1); // UTM que não existe
  });

  it("a lista de campanhas passa a usar a atribuição automática no lugar do lançamento manual", async () => {
    await gestor.req("POST", `/api/marketing/campanhas/${campUtm}/resultados`, { mes: hoje.slice(0, 7), reservas: 99, passageiros: 99, fonte: "manual" });
    const l = (await gestor.req("GET", "/api/marketing/campanhas")).json();
    const c = l.campanhas.find((x: { id: string }) => x.id === campUtm);
    expect(c.atribuicao).toMatchObject({ tipo: "AUTOMATICA", pedidos: 1 });
    expect(c.totais).toMatchObject({ reservas: 1, receitaCentavos: 30_000 });
    expect(c.resultados).toHaveLength(1); // o lançamento manual continua guardado
    const cupom = l.campanhas.find((x: { id: string }) => x.id === campCupom);
    expect(cupom.atribuicao.tipo).toBe("AUTOMATICA");
  });

  it("praça BC não enxerga a atribuição de campanha de FLN", async () => {
    const r = (await supBc.req("GET", "/api/marketing/retorno")).json();
    expect(r.campanhas.find((c: { id: string }) => c.id === campUtm)).toBeUndefined();
    expect(r.afiliados).toEqual([]);
  });

  it("importa o custo do CSV (Google Ads em português) e passa a calcular o custo por reserva com ele", async () => {
    const csv = ["Relatório de campanha", "Período", "Dia;Cliques;Impr.;Custo;Custo / conv.", `${dia(-2)};12;340;"1.234,56";20,00`, `${dia(-1)};8;200;99,90;10,00`, "Total: conta;20;540;1.334,46;"].join("\n");
    expect((await leitor.req("POST", `/api/marketing/campanhas/${campUtm}/custos/csv`, { csv })).statusCode).toBe(403);
    expect((await supBc.req("POST", `/api/marketing/campanhas/${campUtm}/custos/csv`, { csv })).statusCode).toBe(404);
    expect((await gestor.req("POST", `/api/marketing/campanhas/${campUtm}/custos/csv`, { csv: "isto não é um relatório de anúncios" })).statusCode).toBe(400);
    const ok = (await gestor.req("POST", `/api/marketing/campanhas/${campUtm}/custos/csv`, { csv, fonte: "GOOGLE_ADS" })).json();
    expect(ok).toMatchObject({ importados: 2, custoCentavos: 133_446 });
    expect((await gestor.req("POST", `/api/marketing/campanhas/${campUtm}/custos/csv`, { csv })).json().importados).toBe(2); // reenviar não duplica
    const r = (await gestor.req("GET", "/api/marketing/retorno")).json();
    expect(r.campanhas.find((c: { id: string }) => c.id === campUtm)).toMatchObject({ custoOrigem: "CSV", investimentoCentavos: 133_446, cliques: 20, impressoes: 540, custoPorReservaCentavos: 133_446 });
    const l = (await gestor.req("GET", "/api/marketing/campanhas")).json().campanhas.find((x: { id: string }) => x.id === campUtm);
    expect(l.investimentoEfetivoCentavos).toBe(133_446);
    expect(l.custoImportado.dias).toBe(2);
    expect((await gestor.req("DELETE", `/api/marketing/campanhas/${campUtm}/custos`)).statusCode).toBe(200);
  });

  it("gera o link com UTM por campanha (e salva o UTM para a atribuição), por afiliado e livre", async () => {
    const semUtm = (await gestor.req("POST", "/api/marketing/campanhas", { nome: "Promoção de Verão 2027", midia: "META_ADS", inicio: dia(0), investimentoCentavos: 0, unidadeId: flnId })).json().id;
    const l = (await gestor.req("POST", "/api/marketing/links", { campanhaId: semUtm, destino: "https://loja.exemplo.test/passeio", salvarUtm: true })).json();
    const u = new URL(l.url);
    expect([u.searchParams.get("utm_source"), u.searchParams.get("utm_medium"), u.searchParams.get("utm_campaign")]).toEqual(["facebook", "paid_social", "promocao-de-verao-2027"]);
    expect(l.salvouUtm).toBe(true);
    const [c] = await db.select().from(campanhas).where(eq(campanhas.id, semUtm));
    expect(c!.utmCampanha).toBe("promocao-de-verao-2027");
    const af = new URL((await gestor.req("POST", "/api/marketing/links", { afiliadoId, destino: "https://loja.exemplo.test/" })).json().url);
    expect([af.searchParams.get("ref"), af.searchParams.get("utm_source"), af.searchParams.get("utm_campaign")]).toEqual(["HOTEL-RET", "afiliado", "afiliado-hotel-ret"]);
    expect((await gestor.req("POST", "/api/marketing/links", { destino: "http://inseguro.test", origem: "a", midia: "b", campanha: "c" })).statusCode).toBe(400);
    expect((await gestor.req("POST", "/api/marketing/links", { origem: "a" })).statusCode).toBe(400);
    expect((await supBc.req("POST", "/api/marketing/links", { campanhaId: semUtm })).statusCode).toBe(404);
  });
});

describe("relatórios automáticos", () => {
  it("gera só com agregados, compara com o período anterior e respeita a praça", async () => {
    const g = await gestor.req("POST", "/api/marketing/relatorios/gerar", { tipo: "SEMANAL", referencia: hoje });
    expect(g.statusCode).toBe(200);
    expect(g.json().gerados).toBeGreaterThanOrEqual(3); // consolidado + praças ativas
    expect((await gestor.req("POST", "/api/marketing/relatorios/gerar", { tipo: "SEMANAL", referencia: hoje })).json().gerados).toBe(0); // não repete
    expect((await gestor.req("POST", "/api/marketing/relatorios/gerar", { tipo: "SEMANAL", referencia: dia(3) })).statusCode).toBe(400);
    const lista = (await gestor.req("GET", "/api/marketing/relatorios")).json();
    expect(lista.iaLigada).toBe(false);
    // quem tem só a praça FLN não vê o consolidado nem o de BC
    expect(lista.relatorios.every((r: { unidadeId: string | null }) => r.unidadeId === flnId)).toBe(true);
    expect(lista.relatorios).toHaveLength(1);
    const id = lista.relatorios[0].id;
    const d = (await gestor.req("GET", `/api/marketing/relatorios/${id}`)).json();
    expect(d.resumoNumeros).toContain("Reservas:");
    expect(d.resumoIa).toBeNull();
    expect(d.dados.vendas.variacao).toBeDefined();
    expect(d.dados.orcamentos).toBeNull(); // bio e orçamentos só no consolidado
    const todos = (await admin.req("GET", "/api/marketing/relatorios")).json().relatorios as Array<{ id: string; praca: string }>;
    expect(todos.some((r) => r.praca === "Todas as praças")).toBe(true);
    const consolidado = todos.find((r) => r.praca === "Todas as praças")!;
    expect((await gestor.req("GET", `/api/marketing/relatorios/${consolidado.id}`)).statusCode).toBe(404);
    const cons = (await admin.req("GET", `/api/marketing/relatorios/${consolidado.id}`)).json();
    expect(cons.dados.bio).not.toBeNull();
    // LGPD: nenhum dado pessoal nos relatórios
    const linhas = await db.select({ dados: relatoriosMarketing.dados, resumo: relatoriosMarketing.resumoNumeros }).from(relatoriosMarketing);
    expect(JSON.stringify(linhas)).not.toMatch(/Maria|Ana Exemplo|John|Lucía|90000|555 01/);
  });

  it("com a IA ligada junta o resumo da IA (que só recebe agregados); sem IA, só os números", async () => {
    let recebido = "";
    definirClienteIA({ enviar: async (p) => { recebido = JSON.stringify(p.mensagens); return { content: [{ type: "text", text: "Resumo da IA de teste." }], stop_reason: "end_turn", modelo: "falso", usage: { input_tokens: 10, output_tokens: 5 } }; } });
    try {
      const g = await admin.req("POST", "/api/marketing/relatorios/gerar", { tipo: "SEMANAL", referencia: hoje, regenerar: true });
      expect(g.statusCode).toBe(200);
      const lista = (await admin.req("GET", "/api/marketing/relatorios")).json();
      expect(lista.iaLigada).toBe(true);
      const d = (await admin.req("GET", `/api/marketing/relatorios/${lista.relatorios[0].id}`)).json();
      expect(d.resumoIa).toBe("Resumo da IA de teste.");
      expect(recebido).not.toMatch(/Maria|Ana Exemplo|90000|@/);
      expect(recebido).toContain("vendas");
    } finally {
      definirClienteIA(null);
    }
  });

  it("falha da IA não derruba o relatório", async () => {
    definirClienteIA({ enviar: async () => { throw new Error("IA fora do ar"); } });
    try {
      expect((await admin.req("POST", "/api/marketing/relatorios/gerar", { tipo: "MENSAL", referencia: hoje })).statusCode).toBe(200);
    } finally { definirClienteIA(null); }
    const m = (await admin.req("GET", "/api/marketing/relatorios?tipo=MENSAL")).json().relatorios[0];
    expect((await admin.req("GET", `/api/marketing/relatorios/${m.id}`)).json().resumoIa).toBeNull();
  });

  it("a rotina gera na segunda às 7h e no dia 1, sem repetir", async () => {
    // segunda-feira 2027-03-01 também é dia 1: semanal + mensal
    const seg = new Date("2027-03-01T10:30:00Z"); // 07:30 em Brasília
    const antes = (await db.select({ id: relatoriosMarketing.id }).from(relatoriosMarketing)).length;
    const r = await rodarRotinasMarketing(db, config, logFalso, seg);
    expect(r.relatorios).toEqual(["SEMANAL", "MENSAL"]);
    const depois = (await db.select({ id: relatoriosMarketing.id }).from(relatoriosMarketing)).length;
    expect(depois).toBeGreaterThan(antes);
    const r2 = await rodarRotinasMarketing(db, config, logFalso, seg);
    expect(r2.relatorios).toEqual([]);
    expect((await db.select({ id: relatoriosMarketing.id }).from(relatoriosMarketing)).length).toBe(depois);
    // antes das 7h e fora de segunda/dia 1: nada
    expect((await rodarRotinasMarketing(db, config, logFalso, new Date("2027-03-09T12:00:00Z"))).relatorios).toEqual([]);
    expect((await rodarRotinasMarketing(db, config, logFalso, new Date("2027-04-05T09:00:00Z"))).relatorios).toEqual([]); // 06:00 em Brasília
  });
});

describe("link na bio", () => {
  let botaoId = "";
  it("só quem enxerga todas as praças configura; botão exige https", async () => {
    expect((await gestor.req("POST", "/api/marketing/bio/botoes", { rotulo: "Reservar", url: "https://paytour.exemplo.test/bybus", tipo: "PAYTOUR" })).statusCode).toBe(403);
    expect((await admin.req("POST", "/api/marketing/bio/botoes", { rotulo: "Inseguro", url: "http://paytour.exemplo.test" })).statusCode).toBe(400);
    expect((await admin.req("POST", "/api/marketing/bio/botoes", { rotulo: "Script", url: "javascript:alert(1)" })).statusCode).toBe(400);
    const b = await admin.req("POST", "/api/marketing/bio/botoes", { rotulo: "Reservar na Paytour", url: "https://paytour.exemplo.test/bybus", tipo: "PAYTOUR", destaque: true, ordem: 1 });
    expect(b.statusCode).toBe(200);
    botaoId = b.json().id;
    await admin.req("POST", "/api/marketing/bio/botoes", { rotulo: "Escondido", url: "https://exemplo.test/escondido", ativo: false });
    expect((await admin.req("PATCH", "/api/marketing/bio/config", { corPrimaria: "vermelho" })).statusCode).toBe(400);
    expect((await admin.req("PATCH", "/api/marketing/bio/config", { cupomCodigo: "ilha10", cupomTexto: "10% de desconto", corPrimaria: "#112233" })).json()).toMatchObject({ cupomCodigo: "ILHA10", corPrimaria: "#112233" });
  });

  it("a página pública não pede login e só mostra botões ativos", async () => {
    const r = await new Cliente(app).req("GET", "/api/publico/bio");
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.botoes.map((b: { rotulo: string }) => b.rotulo)).toEqual(["Reservar na Paytour"]);
    expect(j.cupom).toEqual({ codigo: "ILHA10", texto: "10% de desconto" });
    expect(Object.keys(j.botoes[0]).sort()).toEqual(["destaque", "id", "rotulo", "tipo", "url"]);
  });

  it("conta visitas e cliques agregados por botão, dia e origem, sem guardar IP nem dado pessoal", async () => {
    const anon = new Cliente(app);
    expect((await anon.req("POST", "/api/publico/bio/visita", { origem: "Instagram" })).statusCode).toBe(200);
    expect((await anon.req("POST", "/api/publico/bio/visita", { origem: "instagram" })).statusCode).toBe(200);
    expect((await anon.req("POST", "/api/publico/bio/clique", { botaoId, origem: "instagram" })).statusCode).toBe(200);
    expect((await anon.req("POST", "/api/publico/bio/clique", { botaoId, origem: "joao@exemplo.test" })).statusCode).toBe(200);
    expect((await anon.req("POST", "/api/publico/bio/clique", { botaoId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(404);
    expect((await anon.req("POST", "/api/publico/bio/clique", { botaoId: "nao-e-uuid" })).statusCode).toBe(400);
    const linhas = await db.select().from(bioCliques);
    expect(Object.keys(linhas[0]!).sort()).toEqual(["chave", "contagem", "dia", "id", "origem"]);
    expect(JSON.stringify(linhas)).not.toContain("@");
    const n = (await leitor.req("GET", "/api/marketing/bio/cliques")).json();
    expect(n).toMatchObject({ visitas: 2, cliques: 2, taxaCliquePorVisita: 100 });
    expect(n.porBotao[0]).toMatchObject({ id: botaoId, cliques: 2 });
    expect(n.porOrigem.find((o: { origem: string }) => o.origem === "instagram")).toMatchObject({ visitas: 2, cliques: 1 });
  });

  it("o limite de taxa por IP barra o excesso de cliques", async () => {
    const outro = await subirApp(); // outra instância: contador de limite próprio
    try {
      const c = new Cliente(outro.app);
      let ultimo = 200;
      for (let i = 0; i < 65; i++) ultimo = (await c.req("POST", "/api/publico/bio/visita", {})).statusCode;
      expect(ultimo).toBe(429);
    } finally { await outro.fechar(); }
  });

  it("apagar o botão apaga os cliques dele", async () => {
    expect((await admin.req("DELETE", `/api/marketing/bio/botoes/${botaoId}`)).statusCode).toBe(200);
    expect((await db.select().from(bioCliques).where(eq(bioCliques.chave, botaoId))).length).toBe(0);
  });
});

describe("orçamento de grupos", () => {
  const assinar = (ms: number) => createHmac("sha256", CHAVE).update(`orcamento|${ms}`).digest("hex");
  const tokenAntigo = () => { const ms = Date.now() - 10_000; return `${ms}.${assinar(ms)}`; };
  const valido = (extra: Record<string, unknown> = {}) => ({
    nome: "Carla Fictícia", organizacao: "Escola Modelo (fictícia)", tipoGrupo: "ESCOLA", telefone: "+55 48 90000-0099", email: "carla@exemplo.test", dataPretendida: dia(30), pessoas: 45,
    servico: "City Tour Toda Ilha", cidadeOrigem: "Chapecó", mensagem: "Passeio de fim de ano.", consentimento: true, formToken: tokenAntigo(), utmSource: "Instagram", ...extra,
  });
  let pedidoId = "";

  it("o formulário público devolve passeios e um token assinado, sem login", async () => {
    const r = (await new Cliente(app).req("GET", "/api/publico/orcamento/formulario")).json();
    expect(r.token).toMatch(/^\d{13}\.[0-9a-f]{64}$/);
    expect(r.passeios.length).toBeGreaterThan(0);
  });

  it("recebe o pedido com consentimento e origem, e guarda sem IP", async () => {
    const r = await new Cliente(app).req("POST", "/api/publico/orcamento", valido());
    expect(r.statusCode).toBe(200);
    expect(r.json().protocolo).toMatch(/^[0-9A-F]{8}$/);
    expect((await new Cliente(app).req("POST", "/api/publico/orcamento", valido({ dataPretendida: dia(-1) }))).json().codigo).toBe("DATA_PASSADA");
    const [o] = await db.select().from(orcamentosGrupo);
    pedidoId = o!.id;
    expect(o).toMatchObject({ status: "NOVO", pessoas: 45, utmSource: "instagram", consentimentoVersao: "2026-11-06" });
    expect(o!.consentimentoEm).toBeInstanceOf(Date);
    const aud = (await db.select().from(auditoria).where(eq(auditoria.acao, "ORCAMENTO_RECEBIDO")))[0]!;
    expect(aud.ip).toBeNull();
    expect(JSON.stringify(aud.dados)).not.toMatch(/Carla|90000|@/);
  });

  it("a isca finge sucesso e não grava; recusa sem consentimento, sem contato, sem tempo mínimo ou com token falso; limita a taxa", async () => {
    const outro = await subirApp();
    try {
      const c = new Cliente(outro.app);
      const antes = (await db.select().from(orcamentosGrupo)).length;
      const e = async (corpo: Record<string, unknown>) => c.req("POST", "/api/publico/orcamento", corpo);
      // isca preenchida: resposta de sucesso, nada gravado
      const isca = await e(valido({ site: "http://spam.test" }));
      expect(isca.statusCode).toBe(200);
      expect((await db.select().from(orcamentosGrupo)).length).toBe(antes);
      expect((await e(valido({ consentimento: false }))).statusCode).toBe(400);
      expect((await e(valido({ telefone: undefined, email: undefined }))).json().detalhes[0].mensagem).toMatch(/telefone/);
      const rapido = `${Date.now()}.${assinar(Date.now())}`;
      expect((await e(valido({ formToken: rapido }))).json().codigo).toBe("FORMULARIO_EXPIRADO");
      expect((await e(valido({ formToken: `${Date.now() - 10_000}.${"0".repeat(64)}` }))).json().codigo).toBe("FORMULARIO_EXPIRADO");
      // limite de taxa: a 6ª tentativa na hora é barrada, mesmo um pedido perfeito
      expect((await e(valido())).statusCode).toBe(429);
      expect((await db.select().from(orcamentosGrupo)).length).toBe(antes);
    } finally { await outro.fechar(); }
  });

  it("a tela interna exige reservas:editar, esconde contatos de quem não tem manifesto:contatos e registra a mudança", async () => {
    expect((await new Cliente(app).req("GET", "/api/orcamentos")).statusCode).toBe(401);
    expect((await gestor.req("GET", "/api/orcamentos")).statusCode).toBe(403);
    const mascarado = (await atendente.req("GET", "/api/orcamentos")).json();
    expect(mascarado[0]).toMatchObject({ organizacao: "Escola Modelo (fictícia)", telefone: null, email: null, contatosOcultos: true, status: "NOVO" });
    const completo = (await admin.req("GET", "/api/orcamentos")).json();
    expect(completo[0]).toMatchObject({ telefone: "+55 48 90000-0099", contatosOcultos: false });
    expect((await atendente.req("GET", "/api/orcamentos/resumo")).json().novos).toBe(1);
    expect((await atendente.req("GET", "/api/marketing/avisos")).json().orcamentosNovos).toBe(1);

    const resp = (await atendente.req("GET", "/api/orcamentos/responsaveis")).json() as Array<{ id: string; nome: string }>;
    expect(resp.map((r) => r.nome)).toContain("Usuário M2_ATEND");
    expect(resp.map((r) => r.nome)).not.toContain("Usuário M2_LEITOR");
    expect((await atendente.req("PATCH", `/api/orcamentos/${pedidoId}`, { status: "EM_CONTATO", responsavelId: resp[0]!.id, anotacoes: "Liguei, vai pensar." })).statusCode).toBe(200);
    expect((await atendente.req("PATCH", `/api/orcamentos/${pedidoId}`, { status: "INVENTADO" })).statusCode).toBe(400);
    expect((await atendente.req("PATCH", `/api/orcamentos/${pedidoId}`, { responsavelId: "00000000-0000-4000-8000-000000000000" })).statusCode).toBe(400);
    expect((await atendente.req("GET", "/api/orcamentos/resumo")).json()).toMatchObject({ novos: 0, porStatus: { EM_CONTATO: 1 } });
    const aud = (await db.select().from(auditoria).where(eq(auditoria.acao, "ORCAMENTO_ATUALIZADO")))[0]!;
    expect(aud.dados).toMatchObject({ statusAntes: "NOVO", statusDepois: "EM_CONTATO" });
  });

  it("anonimiza a pedido do titular (LGPD)", async () => {
    expect((await atendente.req("POST", `/api/orcamentos/${pedidoId}/anonimizar`)).statusCode).toBe(200);
    const [o] = await db.select().from(orcamentosGrupo).where(eq(orcamentosGrupo.id, pedidoId));
    expect(o).toMatchObject({ nome: "Anonimizado", telefone: null, email: null, mensagem: null, anotacoes: null });
    expect(o!.anonimizadoEm).toBeInstanceOf(Date);
    expect((await atendente.req("PATCH", `/api/orcamentos/${pedidoId}`, { anotacoes: "nova" })).statusCode).toBe(409);
  });
});

describe("mensagens automáticas e NPS", () => {
  let rVia = "", rPt = "", rBaixa = "", rSemTel = "";
  const linkNps = async (reservaId: string) => {
    const [m] = await db.select().from(mensagens).where(eq(mensagens.reservaId, reservaId));
    return /\/nps\/([A-Za-z0-9_-]{20,})/.exec(m!.texto)?.[1] ?? "";
  };
  beforeAll(async () => {
    // vendas e passeios de "ontem" para o pós-passeio; uma reserva recém-comprada para a confirmação
    rPt = (await reservaFicticia({ data: dia(-1), codigo: "M2-NPS-PT", nome: "Paula Nps Fictícia", telefone: "+55 48 90000-0101" })).reservaId;
    rBaixa = (await reservaFicticia({ data: dia(-1), codigo: "M2-NPS-BX", nome: "Bruno Baixa Fictício", telefone: "+55 48 90000-0102" })).reservaId;
    rVia = (await reservaFicticia({ data: dia(-1), codigo: "M2-NPS-VIA", canal: "VIATOR", nome: "Tom Viator Teste", telefone: "+1 415 555 0102" })).reservaId;
    rSemTel = (await reservaFicticia({ data: dia(-1), codigo: "M2-NPS-ST", telefone: null })).reservaId;
    await reservaFicticia({ data: dia(-1), codigo: "M2-NPS-NS", embarque: "NO_SHOW", telefone: "+55 48 90000-0103" });
  });

  it("começa tudo desligado (a confirmação da compra segue MENSAGEM_VOUCHER_AUTOMATICA) e a véspera é só informativa", async () => {
    const m = (await leitor.req("GET", "/api/marketing/mensagens")).json();
    const f = (c: string) => m.fluxos.find((x: { codigo: string }) => x.codigo === c);
    expect(f("COMPRA")).toMatchObject({ ligado: false, origemDoLigado: "VARIAVEL_DE_AMBIENTE" });
    expect(f("POS_PASSEIO").ligado).toBe(false);
    expect(f("VESPERA")).toMatchObject({ ligado: true, editavel: false });
    expect(m.envio.real).toBe(false);
    expect((await admin.req("PATCH", "/api/marketing/mensagens/VESPERA", { ligado: false })).statusCode).toBe(400);
    const r = (await admin.req("POST", "/api/marketing/mensagens/rodar")).json();
    expect(r).toMatchObject({ compra: 0, posPasseio: 0, simulado: true });
    expect(await db.select().from(npsRespostas)).toHaveLength(0);
  });

  it("só quem enxerga todas as praças liga fluxos; o texto do pós-passeio precisa do link", async () => {
    expect((await gestor.req("PATCH", "/api/marketing/mensagens/POS_PASSEIO", { ligado: true })).statusCode).toBe(403);
    expect((await admin.req("PATCH", "/api/marketing/mensagens/POS_PASSEIO", { textos: { pt: "Texto sem o link da pesquisa aqui" } })).json().codigo).toBe("FALTA_LINK");
    expect((await admin.req("PATCH", "/api/marketing/mensagens/CUPOM_RETORNO", { ligado: true })).json().codigo).toBe("FALTA_CUPOM");
    expect((await admin.req("PATCH", "/api/marketing/mensagens/AVALIACAO", { textos: { pt: "Texto qualquer aqui" } })).json().codigo).toBe("TEXTO_FIXO");
    expect((await admin.req("PATCH", "/api/marketing/mensagens/POS_PASSEIO", { ligado: true })).statusCode).toBe(200);
    expect((await admin.req("PATCH", "/api/marketing/mensagens/CUPOM_RETORNO", { ligado: true, extra: "volte10", textos: { pt: "Volte com o cupom {cupom} e ganhe desconto." } })).statusCode).toBe(200);
  });

  it("antes das 9h a rotina não manda nada; depois manda o NPS no idioma do cliente, em modo simulado, uma vez só", async () => {
    const cedo = await rodarMensagensAutomaticas(db, config, new Date(`${hoje}T11:00:00Z`)); // 08:00 em Brasília
    expect(cedo.posPasseio).toBe(0);
    const r = (await admin.req("POST", "/api/marketing/mensagens/rodar")).json();
    expect(r.posPasseio).toBe(7); // 3 de ontem + 4 de anteontem (a rotina recupera até 3 dias); sem os "não vieram" e sem a reserva sem telefone
    expect((await admin.req("POST", "/api/marketing/mensagens/rodar")).json().posPasseio).toBe(0);
    const msgs = await db.select().from(mensagens).where(eq(mensagens.tipo, "POS_PASSEIO"));
    expect(msgs).toHaveLength(7);
    expect(msgs.every((m) => m.status === "SIMULADA" && m.provedor === "simulado")).toBe(true);
    const via = msgs.find((m) => m.reservaId === rVia)!;
    expect(via.texto).toContain("Hi Tom!");
    expect(via.texto).toMatch(/https:\/\/app\.bybus\.test\/nps\/[A-Za-z0-9_-]{32}/);
    expect(msgs.find((m) => m.reservaId === rPt)!.texto).toContain("Olá, Paula!");
    // o token vai só na mensagem: no banco fica o hash
    const [n] = await db.select().from(npsRespostas).where(eq(npsRespostas.reservaId, rPt));
    expect(n!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(msgs.find((m) => m.reservaId === rPt)!.texto).not.toContain(n!.tokenHash);
  });

  it("a página pública do NPS só mostra o necessário e recusa link inválido", async () => {
    const t = await linkNps(rPt);
    const anon = new Cliente(app);
    const r = (await anon.req("GET", `/api/publico/nps/${t}`)).json();
    expect(Object.keys(r).sort()).toEqual(["data", "idioma", "passeio", "respondido", "titular"]);
    expect(r.titular).toBe("Paula");
    expect(JSON.stringify(r)).not.toMatch(/Fictícia|90000|@/);
    expect((await anon.req("GET", `/api/publico/nps/${"x".repeat(32)}`)).statusCode).toBe(404);
    expect((await anon.req("GET", "/api/publico/nps/curto")).statusCode).toBe(400);
    expect((await anon.req("POST", `/api/publico/nps/${t}`, { nota: 11, aceitaConvite: false })).statusCode).toBe(400);
    expect((await anon.req("POST", `/api/publico/nps/${t}`, { nota: 7.5 })).statusCode).toBe(400);
    expect((await anon.req("POST", `/api/publico/nps/${t}`, { nota: "dez" })).statusCode).toBe(400);
  });

  it("nota alta que aceita: recebe o convite (Google/Tripadvisor); o pedido de avaliação vira Enviada; cupom de retorno aparece", async () => {
    const t = await linkNps(rPt);
    const r = await new Cliente(app).req("POST", `/api/publico/nps/${t}`, { nota: 10, comentario: "Tudo ótimo!", aceitaConvite: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().convite).toMatchObject({ viator: false });
    expect(r.json().convite.canais.map((c: { tipo: string }) => c.tipo)).toEqual(["GOOGLE", "TRIPADVISOR"]);
    expect(r.json().cupom).toMatchObject({ codigo: "VOLTE10" });
    expect(r.json().cupom.texto).toContain("VOLTE10");
    const [p] = await db.select().from(avaliacaoPedidos).where(eq(avaliacaoPedidos.reservaId, rPt));
    expect(p).toMatchObject({ status: "ENVIADA" });
    expect(p!.pedidoEm).toBeInstanceOf(Date);
    expect((await new Cliente(app).req("POST", `/api/publico/nps/${t}`, { nota: 9, aceitaConvite: false })).json().codigo).toBe("JA_RESPONDIDO");
    expect((await new Cliente(app).req("GET", `/api/publico/nps/${t}`)).json().respondido).toBe(true);
  });

  it("SEM REVIEW GATING: detrator que aceita também recebe o convite; quem não aceita não recebe, qualquer que seja a nota; caso interno e alerta", async () => {
    const baixa = await new Cliente(app).req("POST", `/api/publico/nps/${await linkNps(rBaixa)}`, { nota: 3, comentario: "O ônibus atrasou.", aceitaConvite: true });
    expect(baixa.json().convite.canais.map((c: { tipo: string }) => c.tipo)).toEqual(["GOOGLE", "TRIPADVISOR"]); // a nota não filtra
    const viator = await new Cliente(app).req("POST", `/api/publico/nps/${await linkNps(rVia)}`, { nota: 10, aceitaConvite: true });
    expect(viator.json().convite).toEqual({ viator: true, canais: [] }); // Viator: avaliar na própria Viator
    // quem não aceita não recebe convite nem com nota 10: a decisão é só do cliente
    const [rs] = await db.select({ s: reservas.saidaId }).from(reservas).where(eq(reservas.id, rSemTel));
    const caminho = await criarNps(db, rSemTel, rs!.s, "pt", new Date());
    const nao = await new Cliente(app).req("POST", `/api/publico${caminho}`, { nota: 10, aceitaConvite: false });
    expect(nao.statusCode).toBe(200);
    expect(nao.json().convite).toBeNull();
    expect((await db.select().from(avaliacaoPedidos).where(eq(avaliacaoPedidos.reservaId, rSemTel)))[0]?.status ?? "SEM_PEDIDO").not.toBe("ENVIADA");
    // caso interno aberto para a nota 3, não para as demais
    const casos = (await leitor.req("GET", "/api/marketing/nps/casos")).json() as Array<{ id: string; nota: number; titular: string; casoStatus: string }>;
    expect(casos).toHaveLength(1);
    expect(casos[0]).toMatchObject({ nota: 3, titular: "Bruno", casoStatus: "ABERTO" });
    expect(JSON.stringify(casos)).not.toMatch(/90000|Fictício/);
    expect((await atendente.req("GET", "/api/marketing/avisos")).json().casosNpsAbertos).toBe(0); // sem marketing:ver
    expect((await leitor.req("GET", "/api/marketing/avisos")).json().casosNpsAbertos).toBe(1);
    expect((await leitor.req("PATCH", `/api/marketing/nps/casos/${casos[0]!.id}`, { casoStatus: "RESOLVIDO" })).statusCode).toBe(403);
    expect((await supBc.req("PATCH", `/api/marketing/nps/casos/${casos[0]!.id}`, { casoStatus: "RESOLVIDO" })).statusCode).toBe(404);
    expect((await gestor.req("PATCH", `/api/marketing/nps/casos/${casos[0]!.id}`, { casoStatus: "EM_TRATATIVA", casoNota: "Liguei e pedi desculpas." })).statusCode).toBe(200);
    expect((await leitor.req("GET", "/api/marketing/avisos")).json().casosNpsAbertos).toBe(0);
    expect((await supBc.req("GET", "/api/marketing/nps/casos")).json()).toEqual([]);
  });

  it("painel de NPS por mês, passeio e guia, só com agregados", async () => {
    const p = (await leitor.req("GET", `/api/marketing/nps?de=${dia(-5)}&ate=${dia(0)}`)).json();
    expect(p.geral).toMatchObject({ total: 4, promotores: 3, detratores: 1, nps: 50, enviados: 8 });
    expect(p.geral.aceitaramConvite).toBe(3);
    expect(p.porMes[0]).toMatchObject({ total: 4 });
    expect(p.porPasseio.length).toBeGreaterThan(0);
    expect(p.porGuia[0].chave).toBe("Sem guia");
    expect(JSON.stringify(p)).not.toMatch(/Paula|Bruno|Tom|90000|Ótimo|atrasou/i);
    expect((await supBc.req("GET", `/api/marketing/nps?de=${dia(-5)}&ate=${dia(0)}`)).json().geral.total).toBe(0);
  });

  it("confirmação da compra: só reservas novas de passeios futuros, uma vez, e respeita o liga/desliga", async () => {
    await reservaFicticia({ data: dia(4), codigo: "M2-CP-1", nome: "Carlos Compra Fictício", telefone: "+34 612 345 678" });
    await reservaFicticia({ data: dia(4), codigo: "M2-CP-VELHA", telefone: "+55 48 90000-0104", criadoEm: new Date(Date.now() - 5 * 86_400_000) });
    expect((await admin.req("POST", "/api/marketing/mensagens/rodar")).json().compra).toBe(0); // desligada
    expect((await admin.req("PATCH", "/api/marketing/mensagens/COMPRA", { ligado: true })).json().fluxos.find((f: { codigo: string }) => f.codigo === "COMPRA").origemDoLigado).toBe("TELA");
    expect((await admin.req("POST", "/api/marketing/mensagens/rodar")).json().compra).toBeGreaterThanOrEqual(1); // inclui as reservas fictícias da semente (recentes, passeio futuro)
    expect((await admin.req("POST", "/api/marketing/mensagens/rodar")).json().compra).toBe(0);
    const velha = await db.select().from(mensagens).where(eq(mensagens.tipo, "COMPRA"));
    expect(velha.some((x) => x.texto.includes("Carlos"))).toBe(true);
    expect(velha.length).toBeLessThan(60);
    const m = velha.find((x) => x.texto.includes("Carlos"))!;
    expect(m.texto).toContain("¡Hola, Carlos!");
    expect(m.status).toBe("SIMULADA");
    const [antiga] = await db.select({ id: reservas.id }).from(reservas).where(eq(reservas.codigoExterno, "M2-CP-VELHA"));
    expect(velha.some((x) => x.reservaId === antiga!.id)).toBe(false); // compra de 5 dias atrás não entra
    expect((await admin.req("PATCH", "/api/marketing/mensagens/COMPRA", { ligado: false })).statusCode).toBe(200);
  });

  it("auditoria dos fluxos, relatórios, bio e orçamentos sem dados pessoais", async () => {
    const linhas = await db.select({ acao: auditoria.acao, dados: auditoria.dados }).from(auditoria);
    const acoes = new Set(linhas.map((l) => l.acao));
    for (const a of ["FLUXO_MENSAGEM_EDITADO", "RELATORIO_MARKETING_GERADO", "BIO_BOTAO_CRIADO", "BIO_CONFIG_EDITADA", "ORCAMENTO_ATUALIZADO", "ORCAMENTO_ANONIMIZADO", "NPS_RESPONDIDO", "NPS_CASO_ATUALIZADO", "AVALIACAO_PEDIDO_ENVIADO", "AVALIACAO_EXTERNA_LANCADA", "CAMPANHA_CUSTOS_IMPORTADOS", "MENSAGENS_AUTOMATICAS_RODADAS"]) expect(acoes.has(a), a).toBe(true);
    const texto = JSON.stringify(linhas.filter((l) => l.acao.startsWith("NPS_") || l.acao.startsWith("ORCAMENTO_") || l.acao.startsWith("AVALIACAO_")));
    expect(texto).not.toMatch(/O ônibus atrasou|Tudo ótimo|Concorrente Fictício|Liguei/);
  });
});
