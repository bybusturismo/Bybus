import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { finLancamentoAnexos, finLancamentos, perfis, pessoas, unidades, usuarios, usuariosUnidades, veiculosAbastecimentos, waMensagens } from "../src/db/schema.js";
import { SENHA_DEMO } from "../src/db/ficticios.js";
import { gerarHashSenha } from "../src/seguranca/senha.js";
import { aguardarAbastecimentosWhatsapp } from "../src/servicos/abastecimentoWhatsapp.js";
import { baixarMidiaMeta } from "../src/servicos/whatsappMeta.js";
import { definirClienteIA, type BlocoIA, type ClienteIA, type PedidoIA } from "../src/servicos/ia/cliente.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

const TOKEN = "t0ken-de-teste-abastecimento-0123456789abcdef";
let app: FastifyInstance;
let fechar: () => Promise<void>;
let FLN = "", BC = "";
const { db, pool } = criarDb(DATABASE_URL);
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const somar = (n: number) => new Date(Date.parse(`${hoje()}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** JPEG fictício (só o cabeçalho conta para o tipo). */
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("foto ficticia de cupom")]).toString("base64");

/** IA falsa: registra o que recebeu e devolve a leitura do cupom. */
const pedidos: PedidoIA[] = [];
function iaFalsa(leitura: Record<string, unknown>): ClienteIA {
  return {
    async enviar(p) {
      pedidos.push(p);
      const input = { legivel: true, data: hoje(), litros: null, valor_total: null, preco_litro: null, combustivel: null, posto: null, cnpj_posto: null, km_painel: null, placa: null, observacao: null, ...leitura };
      return { content: [{ type: "tool_use", id: "tu_1", name: "registrar_abastecimento", input } as BlocoIA], stop_reason: "tool_use", modelo: "claude-opus-5-5", usage: { input_tokens: 1500, output_tokens: 200 } };
    },
  };
}

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ WHATSAPP_WEBHOOK_TOKEN: TOKEN }));
  const lista = await db.select().from(unidades);
  FLN = lista.find((u) => u.codigo === "FLN")!.id;
  BC = lista.find((u) => u.codigo === "BC")!.id;
  const [perfil] = await db.insert(perfis).values({ codigo: "MOT_ABAST", nome: "Motorista (abastecimento)", permissoes: ["frota:checklist"] }).returning();
  const [u] = await db.insert(usuarios).values({ nome: "Motorista Abastecimento", email: "mot.abast@bybus.test", perfilId: perfil!.id, senhaHash: await gerarHashSenha(SENHA_DEMO), trocarSenha: false }).returning();
  await db.insert(usuariosUnidades).values({ usuarioId: u!.id, unidadeId: FLN });
  await db.insert(pessoas).values({ nome: "Motorista Fictício Zeca", papeis: ["MOTORISTA"], unidadeId: FLN, telefone: "(48) 99999-0001", usuarioId: u!.id });
});
afterAll(async () => { definirClienteIA(null); await fechar(); await pool.end(); });
afterEach(() => { definirClienteIA(null); pedidos.length = 0; });

async function logado(email: string) {
  const c = new Cliente(app);
  expect((await c.login(email)).statusCode).toBe(200);
  return c;
}
async function veiculo(c: Cliente, placa: string, unidadeId = FLN) {
  const r = await c.req("POST", "/api/frota/veiculos", { unidadeId, placa, tipo: "ONIBUS_DOIS_ANDARES", capacidade: 73, kmAtual: 100_000 });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
}

describe("abastecimento pela foto (app)", () => {
  it("motorista manda a foto, a IA preenche, o motorista completa o km; quem gerencia confere e gera a conta a pagar com o cupom", async () => {
    const admin = await logado("admin@bybus.test");
    const mot = await logado("mot.abast@bybus.test");
    const v = await veiculo(admin, "ABT1A11");
    definirClienteIA(iaFalsa({ litros: 45.5, valor_total: 312.45, posto: "Posto Fictício Ilha", preco_litro: 6.867 }));
    const r = await mot.req("POST", "/api/frota/abastecimentos/foto", { veiculoId: v, fotos: [{ nome: "cupom.jpg", base64: JPG }] });
    expect(r.statusCode, r.body).toBe(201);
    const p = r.json();
    expect(p).toMatchObject({ situacao: "PENDENTE", origem: "APP", litros: 45.5, valorCentavos: 31245, posto: "Posto Fictício Ilha", placa: "ABT1A11", faltas: ["km do painel"], iaLigada: true });
    expect(p.fotos).toHaveLength(1);
    // a foto foi para a IA como imagem
    const blocos = pedidos[0]!.mensagens[0]!.content as BlocoIA[];
    expect(blocos[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg" } });
    // pendente não entra no km/l nem na lista dos conferidos
    expect((await admin.req("GET", `/api/frota/abastecimentos?veiculoId=${v}`)).json().itens).toHaveLength(0);
    // motorista vê só os dele, completa o km, mas não confere
    expect((await mot.req("GET", "/api/frota/abastecimentos/pendentes")).json().itens.map((x: { id: string }) => x.id)).toEqual([p.id]);
    const km = await mot.req("PATCH", `/api/frota/abastecimentos/${p.id}`, { km: 100_450 });
    expect(km.json().faltas).toEqual([]);
    const corpo = { veiculoId: v, data: hoje(), km: 100_450, litros: 45.5, valorCentavos: 31245, posto: "Posto Fictício Ilha", tanqueCheio: true };
    expect((await mot.req("POST", `/api/frota/abastecimentos/${p.id}/conferir`, corpo)).statusCode).toBe(403);
    // a foto abre para quem vê
    expect((await admin.req("GET", `/api/frota/abastecimentos/fotos/${p.fotos[0].id}`)).headers["content-type"]).toBe("image/jpeg");
    const conf = await admin.req("POST", `/api/frota/abastecimentos/${p.id}/conferir`, corpo);
    expect(conf.statusCode, conf.body).toBe(200);
    expect(conf.json()).toMatchObject({ situacao: "CONFERIDO" });
    expect((await admin.req("POST", `/api/frota/abastecimentos/${p.id}/conferir`, corpo)).json().codigo).toBe("JA_CONFERIDO");
    // conta a pagar: Combustível, praça e placa do veículo, cartão (padrão de Florianópolis) vencendo no dia, com o cupom anexado
    const lancId = conf.json().lancamentoId as string;
    const [l] = await db.select().from(finLancamentos).where(eq(finLancamentos.id, lancId));
    expect(l).toMatchObject({ tipo: "PAGAR", valorCentavos: 31245, unidadeId: FLN, veiculo: "ABT1A11", forma: "CARTAO", vencimento: hoje(), situacao: "ABERTO", contraparte: "Posto Fictício Ilha" });
    const anexos = await db.select().from(finLancamentoAnexos).where(eq(finLancamentoAnexos.lancamentoId, lancId));
    expect(anexos.map((a) => a.tipo)).toEqual(["NF"]);
    expect((await admin.req("GET", `/api/financeiro/anexos/${anexos[0]!.id}`)).headers["content-type"]).toBe("image/jpeg");
    // km do veículo subiu; aparece na lista com o pagamento em aberto
    expect((await admin.req("GET", "/api/frota/veiculos")).json().find((x: { id: string }) => x.id === v).kmAtual).toBe(100_450);
    const item = (await admin.req("GET", `/api/frota/abastecimentos?veiculoId=${v}`)).json().itens[0];
    expect(item.pagamento).toMatchObject({ situacao: "ABERTO", comprovante: false });
    // Financeiro paga: a frota mostra pago; excluir passa a ser recusado
    const conta = (await admin.req("POST", "/api/financeiro/contas", { nome: "Cartão teste abast", tipo: "CORRENTE", unidadeId: FLN })).json().id;
    expect((await admin.req("POST", `/api/financeiro/lancamentos/${lancId}/baixa`, { pagoEm: hoje(), contaId: conta })).statusCode).toBe(200);
    expect((await admin.req("GET", `/api/frota/abastecimentos?veiculoId=${v}`)).json().itens[0].pagamento).toMatchObject({ situacao: "REALIZADO", pagoEm: hoje() });
    expect((await admin.req("DELETE", `/api/frota/abastecimentos/${p.id}`)).json().codigo).toBe("CONTA_PAGA");
  });

  it("BC faturado: vencimento soma o prazo configurado; excluir conferido com conta em aberto leva a conta junto", async () => {
    const admin = await logado("admin@bybus.test");
    const v = await veiculo(admin, "ABT2B22", BC);
    const cfg = (await admin.req("GET", "/api/frota/pagamento-combustivel")).json();
    expect(cfg[BC]).toMatchObject({ forma: "FATURADO", prazoDias: 30 });
    expect((await admin.req("PUT", "/api/frota/pagamento-combustivel", { [BC]: { forma: "FATURADO", prazoDias: 15 } })).json()[BC].prazoDias).toBe(15);
    const p = (await admin.req("POST", "/api/frota/abastecimentos/foto", { veiculoId: v, km: 100_300, litros: 80, valorCentavos: 50000, fotos: [{ nome: "c.jpg", base64: JPG }] })).json();
    expect(p).toMatchObject({ faltas: [], iaLigada: false, leituraIa: null }); // IA desligada: segue sem leitura
    const conf = (await admin.req("POST", `/api/frota/abastecimentos/${p.id}/conferir`, { veiculoId: v, data: hoje(), km: 100_300, litros: 80, valorCentavos: 50000 })).json();
    const [l] = await db.select().from(finLancamentos).where(eq(finLancamentos.id, conf.lancamentoId));
    expect(l).toMatchObject({ forma: "BOLETO", vencimento: somar(15) });
    const del = await admin.req("DELETE", `/api/frota/abastecimentos/${p.id}`);
    expect(del.json()).toMatchObject({ ok: true, contaExcluida: true });
    expect(await db.select().from(finLancamentos).where(eq(finLancamentos.id, conf.lancamentoId))).toHaveLength(0);
  });

  it("lançamento manual pode gerar a conta; arquivo que não é foto é recusado; outra praça não vê o pendente", async () => {
    const admin = await logado("admin@bybus.test");
    const mot = await logado("mot.abast@bybus.test");
    const v = await veiculo(admin, "ABT3C33");
    const man = await admin.req("POST", "/api/frota/abastecimentos", { veiculoId: v, data: hoje(), km: 100_200, litros: 30, valorCentavos: 20000, gerarConta: true, formaPagamento: "PIX" });
    expect(man.statusCode, man.body).toBe(201);
    const [l] = await db.select().from(finLancamentos).where(eq(finLancamentos.id, man.json().lancamentoId));
    expect(l).toMatchObject({ forma: "PIX", valorCentavos: 20000 });
    expect((await mot.req("POST", "/api/frota/abastecimentos/foto", { fotos: [{ nome: "x.exe", base64: Buffer.from("MZ...").toString("base64") }] })).json().codigo).toBe("ARQUIVO_TIPO");
    const vbc = await veiculo(admin, "ABT4D44", BC);
    expect((await mot.req("POST", "/api/frota/abastecimentos/foto", { veiculoId: vbc, fotos: [{ nome: "c.jpg", base64: JPG }] })).statusCode).toBe(404);
  });
});

describe("abastecimento pelo WhatsApp (Evolution)", () => {
  const imagem = (id: string, tel: string, legenda: string | null) => ({
    event: "messages.upsert", instance: "bybus",
    data: { key: { remoteJid: `${tel}@s.whatsapp.net`, fromMe: false, id }, messageTimestamp: Math.floor(Date.now() / 1000),
      message: { imageMessage: { caption: legenda ?? undefined, mimetype: "image/jpeg" }, base64: JPG } },
  });
  const texto = (id: string, tel: string, t: string) => ({
    event: "messages.upsert", instance: "bybus",
    data: { key: { remoteJid: `${tel}@s.whatsapp.net`, fromMe: false, id }, messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: t } },
  });
  const avisar = async (corpo: unknown) => {
    const r = await app.inject({ method: "POST", url: `/api/interno/whatsapp/${TOKEN}`, payload: corpo as never });
    await aguardarAbastecimentosWhatsapp();
    return r;
  };
  const respostas = async (tel: string) => (await db.select({ texto: waMensagens.texto, direcao: waMensagens.direcao }).from(waMensagens)).filter((m) => m.direcao === "SAIDA").map((m) => m.texto ?? "");

  it("foto do motorista com a placa na legenda abre o pendente, pergunta o km e completa com a resposta", async () => {
    const admin = await logado("admin@bybus.test");
    const v = await veiculo(admin, "WHA1A11");
    definirClienteIA(iaFalsa({ litros: 60, valor_total: 400, posto: "Posto WhatsApp Fictício" }));
    expect((await avisar(imagem("WA-ABAST-1", "5548999990001", "wha-1a11"))).statusCode).toBe(200);
    const [a] = await db.select().from(veiculosAbastecimentos).where(eq(veiculosAbastecimentos.origem, "WHATSAPP"));
    expect(a).toMatchObject({ situacao: "PENDENTE", veiculoId: v, litros: 60, valorCentavos: 40000, km: null });
    expect((await respostas("5548999990001")).at(-1)).toMatch(/placa WHA1A11 · 60 L · R\$\s?400,00 · Posto WhatsApp Fictício[\s\S]*Falta: km do painel/);
    // a resposta em texto completa o km
    await avisar(texto("WA-ABAST-2", "5548999990001", "km 100.900"));
    const [b] = await db.select().from(veiculosAbastecimentos).where(eq(veiculosAbastecimentos.id, a!.id));
    expect(b!.km).toBe(100_900);
    expect((await respostas("5548999990001")).at(-1)).toMatch(/km 100\.900[\s\S]*pendente até a conferência/);
    expect((await admin.req("GET", "/api/frota/abastecimentos/pendentes")).json().itens.find((x: { id: string }) => x.id === a!.id)).toMatchObject({ pessoaNome: "Motorista Fictício Zeca", faltas: [] });
  });

  it("foto de quem não é motorista segue só como conversa", async () => {
    const antes = (await db.select().from(veiculosAbastecimentos)).length;
    await avisar(imagem("WA-ABAST-3", "5548988887777", "ABC1D23 1234"));
    expect((await db.select().from(veiculosAbastecimentos)).length).toBe(antes);
    expect(await db.select().from(waMensagens).where(eq(waMensagens.idExterno, "WA-ABAST-3"))).toHaveLength(1);
  });

  it("Meta: baixa a mídia pelo id com o token (endereço e arquivo)", async () => {
    const chamadas: string[] = [];
    const buscar = (async (url: string, init?: RequestInit) => {
      chamadas.push(`${url} ${(init?.headers as Record<string, string>)?.Authorization ?? ""}`);
      if (url.endsWith("/MIDIA-1")) return new Response(JSON.stringify({ url: "https://cdn.exemplo.test/arq", mime_type: "image/jpeg" }), { status: 200 });
      return new Response(Buffer.from(JPG, "base64"), { status: 200 });
    }) as unknown as typeof fetch;
    const cfg = (await import("../src/config.js")).lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: Buffer.alloc(32, 7).toString("base64"), META_WA_TOKEN: "token-ficticio" });
    const m = await baixarMidiaMeta(cfg, { type: "image", image: { id: "MIDIA-1", mime_type: "image/jpeg" } }, buscar);
    expect(m?.mime).toBe("image/jpeg");
    expect(m?.bytes.subarray(0, 3).toString("hex")).toBe("ffd8ff");
    expect(chamadas).toEqual(["https://graph.facebook.com/v23.0/MIDIA-1 Bearer token-ficticio", "https://cdn.exemplo.test/arq Bearer token-ficticio"]);
  });
});
