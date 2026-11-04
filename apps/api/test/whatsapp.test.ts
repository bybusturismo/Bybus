import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { criarDb } from "../src/db/cliente.js";
import { auditoria, mensagens, passeios, reservas, saidas, waConversas, waMensagens } from "../src/db/schema.js";
import { enfileirarMensagem } from "../src/servicos/fechamento.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

const TOKEN = "t0ken-de-teste-bem-longo-0123456789abcdef";
const ROTA = `/api/interno/whatsapp/${TOKEN}`;
let app: FastifyInstance;
let fechar: () => Promise<void>;
let config: Parameters<typeof enfileirarMensagem>[1];
let admin: Cliente;
let atendente: Cliente; // praça FLN, ver + responder
let leitor: Cliente; // praça FLN, só ver
let semAcesso: Cliente;
let supBc: Cliente; // praça BC, ver + responder
let flnId = "";
const { db, pool } = criarDb(DATABASE_URL);

async function novoUsuario(perfil: string, permissoes: string[], email: string, unidadeIds: string[]) {
  expect((await admin.req("POST", "/api/perfis", { codigo: perfil, nome: perfil, permissoes })).statusCode).toBe(200);
  const { senhaTemporaria } = (await admin.req("POST", "/api/usuarios", { nome: `Usuário ${perfil}`, email, perfil, unidadeIds })).json();
  const c = new Cliente(app);
  await c.login(email, senhaTemporaria);
  await c.req("POST", "/api/auth/senha", { senhaAtual: senhaTemporaria, novaSenha: "WaTeste123456" });
  return c;
}

const entrada = (id: string, tel: string, texto: string, extra: Record<string, unknown> = {}) => ({
  event: "messages.upsert", instance: "bybus",
  data: { key: { remoteJid: `${tel}@s.whatsapp.net`, fromMe: false, id }, pushName: "Turista Fictício", message: { conversation: texto }, messageTimestamp: Math.floor(Date.now() / 1000), ...extra },
});
const avisar = (corpo: unknown, headers: Record<string, string> = {}, rota = ROTA) =>
  app.inject({ method: "POST", url: rota, payload: corpo as never, headers });

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ WHATSAPP_WEBHOOK_TOKEN: TOKEN }));
  config = (await import("../src/config.js")).lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: Buffer.alloc(32, 7).toString("base64") });
  admin = new Cliente(app);
  expect((await admin.login("admin@bybus.test")).statusCode).toBe(200);
  const un = (await admin.req("GET", "/api/unidades")).json() as Array<{ id: string; codigo: string }>;
  flnId = un.find((u) => u.codigo === "FLN")!.id;
  const bcId = un.find((u) => u.codigo === "BC")!.id;
  atendente = await novoUsuario("WA_ATENDE", ["whatsapp:ver", "whatsapp:responder"], "wa.atende@bybus.test", [flnId]);
  leitor = await novoUsuario("WA_LEITOR", ["whatsapp:ver"], "wa.leitor@bybus.test", [flnId]);
  semAcesso = await novoUsuario("WA_NADA", ["manifesto:ver"], "wa.nada@bybus.test", [flnId]);
  supBc = await novoUsuario("WA_BC", ["whatsapp:ver", "whatsapp:responder"], "wa.bc@bybus.test", [bcId]);
});
afterAll(async () => {
  await pool.end();
  await fechar();
});

describe("aviso da Evolution (rota interna)", () => {
  it("token errado, curto, ausente ou com X-Forwarded-For → 404", async () => {
    const corpo = entrada("ID-NEGADO-1", "5548900001111", "oi");
    expect((await avisar(corpo, {}, "/api/interno/whatsapp/outro-token-qualquer-0123456789abcdefghij")).statusCode).toBe(404);
    expect((await avisar(corpo, {}, "/api/interno/whatsapp/x")).statusCode).toBe(404);
    expect((await avisar(corpo, {}, "/api/interno/whatsapp/")).statusCode).toBe(404);
    expect((await avisar(corpo, { "x-forwarded-for": "203.0.113.9" })).statusCode).toBe(404);
    expect(await db.select().from(waMensagens).where(eq(waMensagens.idExterno, "ID-NEGADO-1"))).toHaveLength(0);
  });

  it("sem WHATSAPP_WEBHOOK_TOKEN configurado a rota não existe (404)", async () => {
    const { app: outro, fechar: f } = await subirApp();
    const r = await outro.inject({ method: "POST", url: ROTA, payload: entrada("ID-NEGADO-2", "5548900001111", "oi") as never });
    expect(r.statusCode).toBe(404);
    await f();
  });

  it("grava a mensagem recebida, cria a conversa e deduplica pelo id externo", async () => {
    expect((await avisar(entrada("ID-1", "5548900002222", "Qual o ponto de embarque?"))).statusCode).toBe(200);
    expect((await avisar(entrada("ID-1", "5548900002222", "Qual o ponto de embarque?"))).statusCode).toBe(200); // reenvio do aviso
    const [c] = await db.select().from(waConversas).where(eq(waConversas.telefone, "5548900002222"));
    expect(c).toMatchObject({ nome: "Turista Fictício", naoLidas: 1, unidadeId: null });
    expect(await db.select().from(waMensagens).where(eq(waMensagens.conversaId, c!.id))).toHaveLength(1);
  });

  it("o mesmo número com e sem o 9 extra cai na mesma conversa", async () => {
    await avisar(entrada("ID-9A", "554899003333", "sem nove")); // 12 dígitos
    await avisar(entrada("ID-9B", "5548999003333", "com nove")); // 13 dígitos, mesmo final
    const cs = await db.select().from(waConversas).where(eq(waConversas.chave, "554899003333"));
    expect(cs).toHaveLength(1);
    expect(await db.select().from(waMensagens).where(eq(waMensagens.conversaId, cs[0]!.id))).toHaveLength(2);
  });

  it("ignora grupo, status, canal, reação e eventos fora da lista", async () => {
    const antes = (await db.select().from(waMensagens)).length;
    await avisar({ event: "messages.upsert", instance: "bybus", data: { key: { remoteJid: "120363000000000000@g.us", fromMe: false, id: "ID-G" }, message: { conversation: "grupo" } } });
    await avisar({ event: "messages.upsert", data: { key: { remoteJid: "status@broadcast", fromMe: false, id: "ID-S" }, message: { conversation: "status" } } });
    await avisar({ event: "messages.upsert", data: { key: { remoteJid: "1203@newsletter", fromMe: false, id: "ID-N" }, message: { conversation: "canal" } } });
    await avisar({ event: "messages.upsert", data: { key: { remoteJid: "5548900004444@s.whatsapp.net", fromMe: false, id: "ID-R" }, message: { reactionMessage: { text: "👍" } } } });
    await avisar({ event: "chats.upsert", data: { key: { remoteJid: "5548900004444@s.whatsapp.net", id: "ID-X" }, message: { conversation: "outro evento" } } });
    await avisar({ ...entrada("ID-O", "5548900004444", "outra instância"), instance: "outra" });
    expect((await db.select().from(waMensagens)).length).toBe(antes);
    expect(await db.select().from(waConversas).where(eq(waConversas.telefone, "5548900004444"))).toHaveLength(0);
  });

  it("mídia registra só o tipo; status READ marca a saída como lida", async () => {
    await avisar(entrada("ID-IMG", "5548900005555", "", { message: { imageMessage: { caption: "foto do hotel", mimetype: "image/jpeg" } } }));
    await avisar(entrada("ID-AUD", "5548900005555", "", { message: { audioMessage: { mimetype: "audio/ogg" } } }));
    const [c] = await db.select().from(waConversas).where(eq(waConversas.telefone, "5548900005555"));
    const ms = await db.select().from(waMensagens).where(eq(waMensagens.conversaId, c!.id));
    expect(ms.map((m) => m.tipo).sort()).toEqual(["AUDIO", "IMAGEM"]);
    // saída nossa com id externo → READ vira LIDA
    await db.insert(waMensagens).values({ conversaId: c!.id, direcao: "SAIDA", texto: "ok", status: "ENVIADA", idExterno: "ID-SAIDA-1" });
    await avisar({ event: "messages.update", instance: "bybus", data: { keyId: "ID-SAIDA-1", status: "READ" } });
    const [s] = await db.select().from(waMensagens).where(eq(waMensagens.idExterno, "ID-SAIDA-1"));
    expect(s!.status).toBe("LIDA");
  });

  it("mensagem enviada pelo celular (fromMe) entra como saída e não duplica", async () => {
    const corpo = { event: "messages.upsert", instance: "bybus", data: { key: { remoteJid: "5548900006666@s.whatsapp.net", fromMe: true, id: "ID-ME" }, message: { conversation: "Respondi pelo celular" } } };
    await avisar(corpo);
    await avisar(corpo);
    const [c] = await db.select().from(waConversas).where(eq(waConversas.telefone, "5548900006666"));
    const ms = await db.select().from(waMensagens).where(eq(waMensagens.conversaId, c!.id));
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ direcao: "SAIDA", status: "ENVIADA" });
    expect(c!.naoLidas).toBe(0);
  });
});

describe("fila automática na conversa", () => {
  it("mensagem da fila aparece na conversa do destinatário; grupo fica de fora; reenvio não duplica", async () => {
    const m = await enfileirarMensagem(db, config, { tipo: "CONFIRMACAO", reservaId: null, saidaId: null, destino: "(48) 90000-7777", texto: "Sua saída é amanhã às 8h." });
    expect(m?.status).toBe("PENDENTE");
    const [c] = await db.select().from(waConversas).where(eq(waConversas.telefone, "5548900007777"));
    const ms = await db.select().from(waMensagens).where(eq(waMensagens.conversaId, c!.id));
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ direcao: "SAIDA", status: "SIMULADA", mensagemFilaId: m!.id, texto: "Sua saída é amanhã às 8h." });
    const { enviarMensagem } = await import("../src/servicos/fechamento.js");
    await db.update(mensagens).set({ status: "PENDENTE" }).where(eq(mensagens.id, m!.id));
    await enviarMensagem(db, config, m!.id);
    expect(await db.select().from(waMensagens).where(eq(waMensagens.conversaId, c!.id))).toHaveLength(1);

    const antes = (await db.select().from(waConversas)).length;
    await enfileirarMensagem(db, config, { tipo: "LISTA_GRUPO_V1", reservaId: null, saidaId: null, destino: "120363111111111111@g.us", texto: "Lista" });
    expect((await db.select().from(waConversas)).length).toBe(antes);
  });
});

describe("telas: permissões, escopo e resposta", () => {
  it("sem login 401; sem whatsapp:ver 403", async () => {
    expect((await new Cliente(app).req("GET", "/api/whatsapp/conversas")).statusCode).toBe(401);
    expect((await semAcesso.req("GET", "/api/whatsapp/conversas")).statusCode).toBe(403);
  });

  it("lista com busca, filtro de não lidas e modo simulado", async () => {
    const r = (await atendente.req("GET", "/api/whatsapp/conversas")).json();
    expect(r.modo).toMatchObject({ simulado: true, envioReal: false });
    expect(r.conversas.length).toBeGreaterThanOrEqual(5);
    const busca = (await atendente.req("GET", "/api/whatsapp/conversas?busca=900002222")).json();
    expect(busca.conversas).toHaveLength(1);
    expect(busca.conversas[0]).toMatchObject({ previa: "Qual o ponto de embarque?", previaDirecao: "ENTRADA", naoLidas: 1 });
    const nl = (await atendente.req("GET", "/api/whatsapp/conversas?naoLidas=1")).json();
    expect(nl.conversas.every((c: { naoLidas: number }) => c.naoLidas > 0)).toBe(true);
    expect((await atendente.req("GET", "/api/whatsapp/conversas?busca=Turista%20Fict")).json().conversas.length).toBeGreaterThan(0);
  });

  it("mensagens paginadas (mais recentes primeiro), marcar como lida", async () => {
    const [c] = await db.select().from(waConversas).where(eq(waConversas.telefone, "5548900002222"));
    for (let i = 0; i < 4; i++) await avisar(entrada(`ID-P${i}`, "5548900002222", `msg ${i}`, { messageTimestamp: Math.floor(Date.now() / 1000) + 10 + i }));
    const p1 = (await atendente.req("GET", `/api/whatsapp/conversas/${c!.id}/mensagens?limite=3`)).json();
    expect(p1.itens.map((m: { texto: string }) => m.texto)).toEqual(["msg 3", "msg 2", "msg 1"]);
    expect(p1.temMais).toBe(true);
    const p2 = (await atendente.req("GET", `/api/whatsapp/conversas/${c!.id}/mensagens?limite=3&antes=${encodeURIComponent(p1.itens[2].criadoEm)}`)).json();
    expect(p2.itens.map((m: { texto: string }) => m.texto)).toEqual(["msg 0", "Qual o ponto de embarque?"]);
    expect(p2.temMais).toBe(false);
    expect((await atendente.req("POST", `/api/whatsapp/conversas/${c!.id}/lida`)).statusCode).toBe(200);
    expect((await db.select().from(waConversas).where(eq(waConversas.id, c!.id)))[0]!.naoLidas).toBe(0);
  });

  it("responder: sem permissão 403; texto vazio/grande 400; modo simulado grava SIMULADA e audita sem texto", async () => {
    const [c] = await db.select().from(waConversas).where(eq(waConversas.telefone, "5548900002222"));
    const url = `/api/whatsapp/conversas/${c!.id}/responder`;
    expect((await leitor.req("POST", url, { texto: "Olá" })).statusCode).toBe(403);
    expect((await atendente.req("POST", url, { texto: "   " })).statusCode).toBe(400);
    expect((await atendente.req("POST", url, { texto: "a".repeat(4097) })).statusCode).toBe(400);
    const r = await atendente.req("POST", url, { texto: "O embarque é no Ponto 3, às 8h." });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "SIMULADA" });
    const [m] = await db.select().from(waMensagens).where(eq(waMensagens.id, r.json().id));
    expect(m).toMatchObject({ direcao: "SAIDA", status: "SIMULADA", texto: "O embarque é no Ponto 3, às 8h.", mensagemFilaId: null });
    expect(m!.enviadaPor).toBeTruthy();
    const aud = (await db.select().from(auditoria).where(eq(auditoria.acao, "whatsapp.responder"))).at(-1)!;
    expect(aud.entidadeId).toBe(c!.id);
    expect(JSON.stringify(aud.dados)).not.toContain("embarque");
  });

  it("nova conversa por telefone (abre a existente, valida o número, envia o primeiro texto)", async () => {
    expect((await atendente.req("POST", "/api/whatsapp/conversas", { telefone: "123" })).statusCode).toBe(400);
    expect((await atendente.req("POST", "/api/whatsapp/conversas", { telefone: "120363111111111111@g.us" })).statusCode).toBe(400);
    expect((await leitor.req("POST", "/api/whatsapp/conversas", { telefone: "48 90000-8888" })).statusCode).toBe(403);
    const r = (await atendente.req("POST", "/api/whatsapp/conversas", { telefone: "(48) 90000-8888", texto: "Olá! Aqui é a By Bus." })).json();
    expect(r.envio.status).toBe("SIMULADA");
    const de = (await atendente.req("POST", "/api/whatsapp/conversas", { telefone: "+55 48 90000-8888" })).json();
    expect(de.id).toBe(r.id);
  });

  it("reservas do telefone aparecem na conversa e definem a praça; escopo de praça isola", async () => {
    const [passeio] = await db.select().from(passeios).where(eq(passeios.unidadeId, flnId));
    const [saida] = await db.insert(saidas).values({ passeioId: passeio!.id, data: "2031-05-10", capacidade: 73 }).returning();
    const [res] = await db.insert(reservas).values({ saidaId: saida!.id, canal: "PAYTOUR", codigoExterno: "WA-RES-1", contatoNome: "Marina Fictícia Souza", contatoTelefone: "+55 48 9 9000-9999" }).returning();
    await db.insert(reservas).values({ saidaId: saida!.id, canal: "PAYTOUR", codigoExterno: "WA-RES-2", contatoNome: "Outra Pessoa", contatoTelefone: "+55 48 9 7000-0000" });
    await avisar(entrada("ID-RES", "554890009999", "Meu voucher não chegou")); // sem o 9: mesma pessoa
    const [c] = await db.select().from(waConversas).where(eq(waConversas.chave, "554890009999"));
    expect(c).toMatchObject({ unidadeId: flnId, nome: "Turista Fictício" });

    const d = (await atendente.req("GET", `/api/whatsapp/conversas/${c!.id}`)).json();
    expect(d.reservas).toHaveLength(1);
    expect(d.reservas[0]).toMatchObject({ reservaId: res!.id, saidaId: saida!.id, data: "2031-05-10", proxima: true });
    expect(JSON.stringify(d)).not.toContain("7000-0000");

    // contato de outra pessoa sem reserva: sem praça
    const [semRes] = await db.select().from(waConversas).where(eq(waConversas.telefone, "5548900002222"));
    expect((await atendente.req("GET", `/api/whatsapp/conversas/${semRes!.id}`)).json().reservas).toEqual([]);

    // praça BC não vê a conversa da praça FLN (404), mas vê as sem praça
    expect((await supBc.req("GET", `/api/whatsapp/conversas/${c!.id}`)).statusCode).toBe(404);
    expect((await supBc.req("GET", `/api/whatsapp/conversas/${c!.id}/mensagens`)).statusCode).toBe(404);
    expect((await supBc.req("POST", `/api/whatsapp/conversas/${c!.id}/responder`, { texto: "x" })).statusCode).toBe(404);
    expect((await supBc.req("POST", `/api/whatsapp/conversas/${c!.id}/lida`)).statusCode).toBe(404);
    const listaBc = (await supBc.req("GET", "/api/whatsapp/conversas?limite=200")).json().conversas as Array<{ id: string }>;
    expect(listaBc.some((x) => x.id === c!.id)).toBe(false);
    expect(listaBc.some((x) => x.id === semRes!.id)).toBe(true);
    const listaFln = (await atendente.req("GET", "/api/whatsapp/conversas?limite=200")).json().conversas as Array<{ id: string }>;
    expect(listaFln.some((x) => x.id === c!.id)).toBe(true);
    // nova conversa pelo telefone de uma conversa de outra praça também é negada
    expect((await supBc.req("POST", "/api/whatsapp/conversas", { telefone: "+55 48 9000-9999" })).statusCode).toBe(404);
  });
});
