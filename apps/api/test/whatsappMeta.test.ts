import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { modeloConfirmacao } from "@bybus/core";
import { lerConfig } from "../src/config.js";
import { criarDb } from "../src/db/cliente.js";
import { mensagens, waConversas, waMensagens } from "../src/db/schema.js";
import { enfileirarMensagem } from "../src/servicos/fechamento.js";
import { chaveTelefone, enviarWhatsapp } from "../src/servicos/whatsapp.js";
import { CHAVE, Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

const META = {
  WHATSAPP_PROVEDOR: "meta", WHATSAPP_ENVIO_REAL: "true", META_WA_TOKEN: "token-ficticio-0000", META_WA_NUMERO_ID: "1234567890",
  META_WA_CONTA_ID: "9876543210", META_APP_SECRET: "segredo-ficticio-do-app-0000", META_WA_VERIFY_TOKEN: "palavra-ficticia-verificacao",
};
const config = lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: CHAVE, EXIGIR_MFA_ADMIN: "false", ...META });
const { db, pool } = criarDb(DATABASE_URL);
let app: FastifyInstance;
let fechar: () => Promise<void>;

const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const assinar = (corpo: string) => `sha256=${createHmac("sha256", META.META_APP_SECRET).update(corpo).digest("hex")}`;
const aviso = (value: Record<string, unknown>) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: META.META_WA_NUMERO_ID }, ...value } }] }] });
const postarAviso = (corpo: string, assinatura = assinar(corpo)) => app.inject({ method: "POST", url: "/api/webhooks/whatsapp", payload: corpo, headers: { "content-type": "application/json", "x-hub-signature-256": assinatura } });

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp(META));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await fechar(); await pool.end(); });

describe("envio pelo WhatsApp oficial", () => {
  const modelo = modeloConfirmacao({ primeiroNome: "Ana", passeio: "City Tour", data: "2027-04-10", ponto: { horario: "08:00", nome: "Villa Romana Shopping", endereco: null }, linkEmbarque: null });
  it("dentro da janela de 24 h vai texto livre; fora, o modelo aprovado; sem modelo, não envia", async () => {
    const buscar = vi.fn(async () => resposta({ messages: [{ id: "wamid.TESTE1" }] }));
    const r1 = await enviarWhatsapp(config, "5548900000001", "Olá!", buscar as unknown as typeof fetch, { janelaAberta: true, modelo });
    expect(r1).toMatchObject({ status: "ENVIADA", provedor: "meta", idExterno: "wamid.TESTE1" });
    const [url1, init1] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url1).toBe("https://graph.facebook.com/v23.0/1234567890/messages");
    expect((init1.headers as Record<string, string>).Authorization).toBe("Bearer token-ficticio-0000");
    expect(JSON.parse(String(init1.body))).toMatchObject({ messaging_product: "whatsapp", to: "5548900000001", type: "text", text: { body: "Olá!" } });

    await enviarWhatsapp(config, "5548900000001", "Olá!", buscar as unknown as typeof fetch, { janelaAberta: false, modelo });
    const corpo2 = JSON.parse(String((buscar.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(corpo2).toMatchObject({ type: "template", template: { name: "bybus_confirmacao", language: { code: "pt_BR" } } });
    expect(corpo2.template.components[0].parameters).toHaveLength(5);

    expect(await enviarWhatsapp(config, "5548900000001", "Olá!", buscar as unknown as typeof fetch, { janelaAberta: false })).toMatchObject({ status: "FALHA", erro: "FORA_DA_JANELA" });
    expect(await enviarWhatsapp(config, "120363000000000000@g.us", "Lista", buscar as unknown as typeof fetch, { janelaAberta: true })).toMatchObject({ status: "FALHA", erro: "GRUPO_NAO_SUPORTADO" });
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("erro da Meta vira FALHA só com o código (sem texto nem telefone)", async () => {
    const buscar = vi.fn(async () => resposta({ error: { code: 131026, message: "Mensagem com o número 5548…" } }, 400));
    const r = await enviarWhatsapp(config, "5548900000001", "Olá!", buscar as unknown as typeof fetch, { janelaAberta: true });
    expect(r).toEqual({ status: "FALHA", provedor: "meta", erro: "HTTP 400 · 131026" });
  });

  it("fora da produção, sem WHATSAPP_ENVIO_REAL, continua simulado", async () => {
    const semReal = lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: CHAVE, ...META, WHATSAPP_ENVIO_REAL: "false" });
    const buscar = vi.fn();
    expect(await enviarWhatsapp(semReal, "5548900000001", "Olá!", buscar as unknown as typeof fetch)).toMatchObject({ status: "SIMULADA" });
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("avisos da Meta (rota pública)", () => {
  it("verificação do endereço só com a palavra combinada", async () => {
    const ok = await app.inject({ method: "GET", url: `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${META.META_WA_VERIFY_TOKEN}&hub.challenge=12345` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("12345");
    expect((await app.inject({ method: "GET", url: "/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errada&hub.challenge=12345" })).statusCode).toBe(403);
  });

  it("recusa assinatura errada e grava a mensagem do cliente, abrindo a janela de 24 h", async () => {
    const corpo = aviso({ contacts: [{ wa_id: "5548900000002", profile: { name: "Cliente Fictício" } }], messages: [{ from: "5548900000002", id: "wamid.ENTRADA1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Qual o horário?" } }] });
    expect((await postarAviso(corpo, "sha256=errada")).statusCode).toBe(401);
    expect((await postarAviso(corpo)).statusCode).toBe(200);
    expect((await postarAviso(corpo)).statusCode).toBe(200); // repetido não duplica
    const [c] = await db.select().from(waConversas).where(eq(waConversas.chave, chaveTelefone("5548900000002")));
    expect(c).toMatchObject({ nome: "Cliente Fictício", naoLidas: 1 });
    expect(c!.ultimaEntradaEm).not.toBeNull();
    const ms = await db.select().from(waMensagens).where(eq(waMensagens.conversaId, c!.id));
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ direcao: "ENTRADA", texto: "Qual o horário?", status: "RECEBIDA" });
  });

  it("ignora aviso de outro número", async () => {
    const corpo = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "111" }, messages: [{ from: "5548900000099", id: "wamid.X", type: "text", text: { body: "oi" } }] } }] }] });
    expect((await postarAviso(corpo)).statusCode).toBe(200);
    expect(await db.select().from(waConversas).where(eq(waConversas.chave, chaveTelefone("5548900000099")))).toHaveLength(0);
  });
});

describe("coexistência e economia de mensagens", () => {
  it("mensagem mandada pelo celular (eco) entra na conversa como nossa", async () => {
    const corpo = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "smb_message_echoes", value: { metadata: { phone_number_id: META.META_WA_NUMERO_ID },
      message_echoes: [{ from: "554899248636", to: "5548900000004", id: "wamid.ECO1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Respondido pelo celular" } }] } }] }] });
    expect((await postarAviso(corpo)).statusCode).toBe(200);
    const [c] = await db.select().from(waConversas).where(eq(waConversas.chave, chaveTelefone("5548900000004")));
    const ms = await db.select().from(waMensagens).where(eq(waMensagens.conversaId, c!.id));
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ direcao: "SAIDA", texto: "Respondido pelo celular", status: "ENVIADA" });
  });

  it("mesma pessoa, mesma saída e mesmo conteúdo: só a primeira mensagem sai (as outras ficam AGRUPADA)", async () => {
    const buscar = vi.fn(async () => resposta({ messages: [{ id: `wamid.AG${buscar.mock.calls.length}` }] }));
    vi.stubGlobal("fetch", buscar);
    const [s] = await db.execute<{ id: string }>(sql`select id from saidas limit 1`).then((r) => r.rows);
    const base = { tipo: "RASTREIO", saidaId: s!.id, destino: "+55 48 90000-0005", modelo: modeloConfirmacao({ primeiroNome: "Caio", passeio: "City Tour", data: "2027-04-10", ponto: null, linkEmbarque: null }) };
    const a = await enfileirarMensagem(db, config, { ...base, reservaId: null, texto: "Olá, Caio! Acompanhe: https://x.test/rastreio/aaa" });
    const b = await enfileirarMensagem(db, config, { ...base, reservaId: null, texto: "Olá, Caio! Acompanhe: https://x.test/rastreio/bbb" });
    const c = await enfileirarMensagem(db, config, { ...base, reservaId: null, texto: "Olá, Duda! Acompanhe: https://x.test/rastreio/ccc" });
    expect(a!.status).toBe("PENDENTE");
    expect(b!.status).toBe("AGRUPADA");
    expect(c!.status).toBe("PENDENTE");
    expect(buscar).toHaveBeenCalledTimes(2);
  });
});

describe("fila automática com a Meta", () => {
  it("usa o modelo fora da janela, texto livre depois que o cliente escreve, e grava falha de entrega", async () => {
    const buscar = vi.fn(async () => resposta({ messages: [{ id: `wamid.SAIDA${buscar.mock.calls.length}` }] }));
    vi.stubGlobal("fetch", buscar);
    const modelo = modeloConfirmacao({ primeiroNome: "Bia", passeio: "City Tour", data: "2027-04-10", ponto: null, linkEmbarque: null });
    const m1 = await enfileirarMensagem(db, config, { tipo: "TESTE_META_1", reservaId: null, saidaId: null, destino: "5548900000003", texto: "Texto livre", modelo });
    expect(JSON.parse(String((buscar.mock.calls[0] as unknown as [string, RequestInit])[1].body)).type).toBe("template");
    // Cliente da conversa anterior (escreveu agora): texto livre.
    await enfileirarMensagem(db, config, { tipo: "TESTE_META_2", reservaId: null, saidaId: null, destino: "5548900000002", texto: "Texto livre", modelo });
    expect(JSON.parse(String((buscar.mock.calls[1] as unknown as [string, RequestInit])[1].body)).type).toBe("text");
    // A Meta avisa que a primeira não foi entregue.
    const [w] = await db.select().from(waMensagens).where(eq(waMensagens.mensagemFilaId, m1!.id));
    const corpo = aviso({ statuses: [{ id: w!.idExterno, status: "failed", errors: [{ code: 131026 }] }] });
    expect((await postarAviso(corpo)).statusCode).toBe(200);
    const [f] = await db.select().from(mensagens).where(eq(mensagens.id, m1!.id));
    expect(f).toMatchObject({ status: "FALHA", erro: "META 131026" });
  });
});

describe("modelos para aprovação", () => {
  it("mostra a situação e envia só os que faltam (quem cuida das integrações)", async () => {
    const chamadas: Array<{ url: string; metodo: string; corpo?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push({ url, metodo: init?.method ?? "GET", corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
      if ((init?.method ?? "GET") === "GET") return resposta({ data: [{ name: "bybus_previa", language: "pt_BR", status: "APPROVED" }, { name: "bybus_rastreio", language: "pt_BR", status: "REJECTED", rejected_reason: "INVALID_FORMAT" }] });
      return resposta({ id: "1", status: "PENDING" });
    }));
    const admin = new Cliente(app);
    expect((await admin.login("admin@bybus.test")).statusCode).toBe(200);
    const sit = (await admin.req("GET", "/api/whatsapp/meta")).json();
    expect(sit).toMatchObject({ configurada: true, avisosLigados: true });
    expect(sit.modelos.find((m: { nome: string }) => m.nome === "bybus_rastreio")).toMatchObject({ status: "REJECTED", motivo: "INVALID_FORMAT" });
    expect(sit.modelos.find((m: { nome: string }) => m.nome === "bybus_confirmacao").status).toBe("NAO_ENVIADO");
    const r = (await admin.req("POST", "/api/whatsapp/meta/modelos/enviar")).json();
    expect(r.enviados.sort()).toEqual(["bybus_confirmacao", "bybus_embarque_chegando", "bybus_embarque_chegou", "bybus_lista_equipe", "bybus_transfer_chegando", "bybus_transfer_chegou"]);
    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect(post.url).toBe("https://graph.facebook.com/v23.0/9876543210/message_templates");
    expect(post.corpo).toMatchObject({ language: "pt_BR", category: "UTILITY", components: [{ type: "BODY" }] });
    const guia = new Cliente(app);
    await guia.login("guia@bybus.test");
    expect((await guia.req("POST", "/api/whatsapp/meta/modelos/enviar")).statusCode).toBe(403);
  });
});
