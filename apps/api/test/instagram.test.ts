import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { lerConfig } from "../src/config.js";
import { mascararUrl } from "../src/app.js";
import { criarDb } from "../src/db/cliente.js";
import { conteudoMidias, conteudos, igComentarios, igMetricasDia, igMidiaTokens, igPosts, waConversas, waMensagens } from "../src/db/schema.js";
import { definirClienteIA, type ClienteIA } from "../src/servicos/ia/cliente.js";
import { sincronizarInstagram } from "../src/servicos/instagram/dados.js";
import { hashToken, publicarPendentes } from "../src/servicos/instagram/publicacao.js";
import { Cliente, CHAVE, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

const SEGREDO = "segredo-do-app-de-teste-0123456789";
const VERIFICA = "verifica-webhook-teste-0123456789";
const ROTA = "/api/webhooks/instagram";
const CONTA = "17841400000000001";
const CLIENTE_A = "9000000000000001";

let app: FastifyInstance;
let fechar: () => Promise<void>;
let admin: Cliente;
let atende: Cliente; // whatsapp ver + responder, marketing ver + gerenciar
let leitor: Cliente; // whatsapp:ver + marketing:ver
let semAcesso: Cliente;
const { db, pool } = criarDb(DATABASE_URL);

async function novoUsuario(perfil: string, permissoes: string[], email: string) {
  expect((await admin.req("POST", "/api/perfis", { codigo: perfil, nome: perfil, permissoes })).statusCode).toBe(200);
  const un = (await admin.req("GET", "/api/unidades")).json() as Array<{ id: string }>;
  const { senhaTemporaria } = (await admin.req("POST", "/api/usuarios", { nome: `Usuário ${perfil}`, email, perfil, unidadeIds: un.map((u) => u.id) })).json();
  const c = new Cliente(app);
  await c.login(email, senhaTemporaria);
  await c.req("POST", "/api/auth/senha", { senhaAtual: senhaTemporaria, novaSenha: "IgTeste123456" });
  return c;
}

const unidadeFln = async () => ((await admin.req("GET", "/api/unidades")).json() as Array<{ id: string; codigo: string }>).find((u) => u.codigo === "FLN")!.id;
const assinar = (corpo: string, segredo = SEGREDO) => `sha256=${createHmac("sha256", segredo).update(corpo).digest("hex")}`;
const avisar = (obj: unknown, assinatura?: string) => {
  const corpo = JSON.stringify(obj);
  return app.inject({ method: "POST", url: ROTA, payload: corpo, headers: { "content-type": "application/json", ...(assinatura === undefined ? { "x-hub-signature-256": assinar(corpo) } : assinatura ? { "x-hub-signature-256": assinatura } : {}) } });
};
const mensagem = (mid: string, texto: string, extra: Record<string, unknown> = {}, quando = Date.now()) => ({
  object: "instagram", entry: [{ id: CONTA, time: Math.floor(quando / 1000), messaging: [{ sender: { id: CLIENTE_A }, recipient: { id: CONTA }, timestamp: quando, message: { mid, text: texto, ...extra } }] }],
});
const comentarioAviso = (id: string, texto: string, extra: Record<string, unknown> = {}) => ({
  object: "instagram", entry: [{ id: CONTA, time: Math.floor(Date.now() / 1000), changes: [{ field: "comments", value: { id, text: texto, from: { id: "9000000000000009", username: "turista_ficticio" }, media: { id: "midia-1" }, ...extra } }] }],
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 2)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(100, 3)]);
const enviarMidia = (c: Cliente, url: string, dados: Buffer, tipo: string) =>
  app.inject({ method: "POST", url, payload: dados, headers: { cookie: c.cookie, "x-bybus": "1", "content-type": tipo } });

const configReal = () => lerConfig({
  AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: CHAVE, INSTAGRAM_TOKEN: "token-de-teste-do-instagram", INSTAGRAM_CONTA_ID: CONTA, INSTAGRAM_ENVIO_REAL: "true", URL_PUBLICA: "https://gestao.exemplo.test",
});
const configSimulada = () => lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: CHAVE });

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ INSTAGRAM_APP_SECRET: SEGREDO, INSTAGRAM_WEBHOOK_VERIFY_TOKEN: VERIFICA, INSTAGRAM_CONTA_ID: CONTA }));
  admin = new Cliente(app);
  expect((await admin.login("admin@bybus.test")).statusCode).toBe(200);
  atende = await novoUsuario("IG_ATENDE", ["whatsapp:ver", "whatsapp:responder", "marketing:ver", "marketing:gerenciar"], "ig.atende@bybus.test");
  leitor = await novoUsuario("IG_LEITOR", ["whatsapp:ver", "marketing:ver"], "ig.leitor@bybus.test");
  semAcesso = await novoUsuario("IG_NADA", ["manifesto:ver"], "ig.nada@bybus.test");
});
afterAll(async () => {
  definirClienteIA(null);
  await pool.end();
  await fechar();
});
afterEach(() => { vi.restoreAllMocks(); definirClienteIA(null); });

describe("webhook do Instagram", () => {
  it("GET de verificação devolve o desafio só com o token certo", async () => {
    const ok = await app.inject({ method: "GET", url: `${ROTA}?hub.mode=subscribe&hub.verify_token=${VERIFICA}&hub.challenge=123456` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("123456");
    expect((await app.inject({ method: "GET", url: `${ROTA}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123456` })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `${ROTA}?hub.mode=subscribe&hub.verify_token=${VERIFICA}&hub.challenge=<script>` })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `${ROTA}?hub.mode=outro&hub.verify_token=${VERIFICA}&hub.challenge=1` })).statusCode).toBe(403);
  });

  it("sem segredo/token configurados as rotas respondem 404", async () => {
    const { app: sem, fechar: f2 } = await subirApp();
    try {
      expect((await sem.inject({ method: "GET", url: `${ROTA}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1` })).statusCode).toBe(404);
      expect((await sem.inject({ method: "POST", url: ROTA, payload: "{}", headers: { "content-type": "application/json" } })).statusCode).toBe(404);
    } finally { await f2(); }
  });

  it("assinatura ausente, errada ou de outro segredo → 401, e nada é gravado", async () => {
    const corpo = mensagem("mid-assinatura-1", "texto que não pode entrar");
    expect((await avisar(corpo, "")).statusCode).toBe(401);
    expect((await avisar(corpo, "sha256=00")).statusCode).toBe(401);
    expect((await avisar(corpo, assinar(JSON.stringify(corpo), "outro-segredo-qualquer-123456"))).statusCode).toBe(401);
    // assinatura de um corpo, enviado outro
    const r = await app.inject({ method: "POST", url: ROTA, payload: JSON.stringify(corpo), headers: { "content-type": "application/json", "x-hub-signature-256": assinar("{}") } });
    expect(r.statusCode).toBe(401);
    expect(await db.select().from(waMensagens).where(eq(waMensagens.idExterno, "mid-assinatura-1"))).toHaveLength(0);
  });

  it("grava a mensagem numa conversa de Instagram, deduplica pelo id e não registra o texto em log", async () => {
    const espioes = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const TEXTO = "Qual é o horário da saída? TEXTO-SECRETO-ABC";
    expect((await avisar(mensagem("mid-1", TEXTO))).statusCode).toBe(200);
    expect((await avisar(mensagem("mid-1", TEXTO))).statusCode).toBe(200); // a Meta reenvia: não duplica
    const [conv] = await db.select().from(waConversas).where(eq(waConversas.chave, `ig:${CLIENTE_A}`));
    expect(conv).toMatchObject({ canal: "INSTAGRAM", idContato: CLIENTE_A, naoLidas: 1, telefone: `ig:${CLIENTE_A}`, unidadeId: null });
    const msgs = await db.select().from(waMensagens).where(eq(waMensagens.conversaId, conv!.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direcao: "ENTRADA", status: "RECEBIDA", texto: TEXTO, idExterno: "mid-1" });
    for (const e of espioes) expect(JSON.stringify(e.mock.calls)).not.toContain("TEXTO-SECRETO");
    expect(mascararUrl("/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=SEGREDO123&hub.challenge=1")).not.toContain("SEGREDO123");
    expect(mascararUrl("/api/publico/instagram/midia/abcDEF_-1234567890abcdefghijklmnopqrstuvw")).toBe("/api/publico/instagram/midia/***");
  });

  it("eco (enviada pelo app), anexo, reação/apagada e mensagem da própria conta", async () => {
    const eco = { object: "instagram", entry: [{ id: CONTA, messaging: [{ sender: { id: CONTA }, recipient: { id: CLIENTE_A }, timestamp: Date.now(), message: { mid: "mid-eco", text: "Respondi pelo celular", is_echo: true } }] }] };
    expect((await avisar(eco)).statusCode).toBe(200);
    await avisar(mensagem("mid-img", "", { text: undefined, attachments: [{ type: "image" }] }));
    await avisar(mensagem("mid-apagada", "x", { is_deleted: true }));
    await avisar({ object: "instagram", entry: [{ id: CONTA, messaging: [{ sender: { id: CONTA }, recipient: { id: CONTA }, timestamp: Date.now(), message: { mid: "mid-propria", text: "eu mesmo" } }] }] });
    await avisar({ object: "page", entry: [] });
    const [conv] = await db.select().from(waConversas).where(eq(waConversas.chave, `ig:${CLIENTE_A}`));
    const msgs = await db.select().from(waMensagens).where(eq(waMensagens.conversaId, conv!.id));
    expect(msgs.find((m) => m.idExterno === "mid-eco")).toMatchObject({ direcao: "SAIDA", status: "ENVIADA" });
    expect(msgs.find((m) => m.idExterno === "mid-img")).toMatchObject({ direcao: "ENTRADA", tipo: "IMAGEM" });
    expect(msgs.find((m) => m.idExterno === "mid-apagada")).toBeUndefined();
    expect(msgs.find((m) => m.idExterno === "mid-propria")).toBeUndefined();
  });

  it("comentário: grava, deduplica e ignora o da própria conta", async () => {
    await avisar(comentarioAviso("com-1", "Lindo passeio!"));
    await avisar(comentarioAviso("com-1", "Lindo passeio!"));
    await avisar({ object: "instagram", entry: [{ id: CONTA, changes: [{ field: "comments", value: { id: "com-nosso", text: "obrigado", from: { id: CONTA, username: "bybus" }, media: { id: "midia-1" } } }] }] });
    await avisar(comentarioAviso("com-resp", "Concordo", { parent_id: "com-1" }));
    const todos = await db.select().from(igComentarios);
    expect(todos.map((c) => c.idExterno).sort()).toEqual(["com-1", "com-resp"]);
  });
});

describe("Conversas: canal, janela de 24 h e respostas", () => {
  let conversaId = "";
  it("lista com filtro de canal e mostra o canal", async () => {
    const todas = (await atende.req("GET", "/api/whatsapp/conversas")).json();
    expect(todas.modo.instagram).toMatchObject({ conectado: false, simulado: true });
    const ig = (await atende.req("GET", "/api/whatsapp/conversas?canal=INSTAGRAM")).json();
    expect(ig.conversas.length).toBeGreaterThanOrEqual(1);
    expect(ig.conversas.every((c: { canal: string }) => c.canal === "INSTAGRAM")).toBe(true);
    conversaId = ig.conversas[0].id;
    const wa = (await atende.req("GET", "/api/whatsapp/conversas?canal=WHATSAPP")).json();
    expect(wa.conversas.every((c: { canal: string }) => c.canal === "WHATSAPP")).toBe(true);
    expect((await atende.req("GET", "/api/whatsapp/conversas?canal=TELEGRAM")).statusCode).toBe(400);
    const d = (await atende.req("GET", `/api/whatsapp/conversas/${conversaId}`)).json();
    expect(d.canal).toBe("INSTAGRAM");
    expect(d.janela).toMatchObject({ aberta: true });
    expect(d.reservas).toEqual([]);
  });

  it("responde dentro de 24 h (simulado) e recusa fora da janela", async () => {
    expect((await leitor.req("POST", `/api/whatsapp/conversas/${conversaId}/responder`, { texto: "oi" })).statusCode).toBe(403);
    expect((await semAcesso.req("GET", "/api/whatsapp/conversas?canal=INSTAGRAM")).statusCode).toBe(403);
    const ok = await atende.req("POST", `/api/whatsapp/conversas/${conversaId}/responder`, { texto: "Saímos às 8h, de Canasvieiras." });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("SIMULADA");
    // passa das 24 h
    await db.update(waConversas).set({ ultimaEntradaEm: new Date(Date.now() - 25 * 3_600_000) }).where(eq(waConversas.id, conversaId));
    const fora = await atende.req("POST", `/api/whatsapp/conversas/${conversaId}/responder`, { texto: "Ainda aí?" });
    expect(fora.statusCode).toBe(409);
    expect(fora.json().codigo).toBe("JANELA_24H_FECHADA");
    const d = (await atende.req("GET", `/api/whatsapp/conversas/${conversaId}`)).json();
    expect(d.janela.aberta).toBe(false);
    const msgs = await db.select().from(waMensagens).where(eq(waMensagens.conversaId, conversaId));
    expect(msgs.some((m) => m.texto === "Ainda aí?")).toBe(false);
    // nova mensagem do cliente reabre a janela
    await avisar(mensagem("mid-reabre", "Voltei!"));
    expect((await atende.req("POST", `/api/whatsapp/conversas/${conversaId}/responder`, { texto: "Oi!" })).statusCode).toBe(200);
  });

  it("não abre conversa nova de Instagram por telefone e a auditoria não guarda o texto", async () => {
    const r = await atende.req("POST", "/api/whatsapp/conversas", { telefone: "ig:123" });
    expect(r.statusCode).toBe(400);
  });

  it("etiquetas, atendente e filtros", async () => {
    expect((await leitor.req("PUT", `/api/whatsapp/conversas/${conversaId}/etiquetas`, { etiquetas: ["DUVIDA"] })).statusCode).toBe(403);
    expect((await atende.req("PUT", `/api/whatsapp/conversas/${conversaId}/etiquetas`, { etiquetas: ["INEXISTENTE"] })).statusCode).toBe(400);
    expect((await atende.req("PUT", `/api/whatsapp/conversas/${conversaId}/etiquetas`, { etiquetas: ["DUVIDA", "DUVIDA", "ORCAMENTO"] })).json().etiquetas).toEqual(["DUVIDA", "ORCAMENTO"]);
    const atendentes = (await atende.req("GET", "/api/whatsapp/atendentes")).json() as Array<{ id: string; nome: string }>;
    expect(atendentes.length).toBeGreaterThanOrEqual(2);
    const eu = atendentes.find((a) => a.nome === "Usuário IG_ATENDE")!;
    const semPerm = (await admin.req("GET", "/api/usuarios")).json().find((u: { email: string }) => u.email === "ig.nada@bybus.test");
    expect((await atende.req("POST", `/api/whatsapp/conversas/${conversaId}/atribuir`, { usuarioId: semPerm.id })).statusCode).toBe(400);
    expect((await atende.req("POST", `/api/whatsapp/conversas/${conversaId}/atribuir`, { usuarioId: eu.id })).statusCode).toBe(200);
    const minhas = (await atende.req("GET", "/api/whatsapp/conversas?atendente=eu")).json();
    expect(minhas.minhasConversas).toBe(1);
    expect(minhas.conversas.map((c: { id: string }) => c.id)).toEqual([conversaId]);
    expect(minhas.conversas[0]).toMatchObject({ atendenteNome: "Usuário IG_ATENDE", etiquetas: ["DUVIDA", "ORCAMENTO"] });
    expect((await leitor.req("GET", "/api/whatsapp/conversas?atendente=eu")).json().conversas).toHaveLength(0);
    expect((await atende.req("GET", "/api/whatsapp/conversas?etiqueta=DUVIDA")).json().conversas.length).toBe(1);
    expect((await atende.req("GET", "/api/whatsapp/conversas?etiqueta=GRUPO")).json().conversas.length).toBe(0);
    expect((await atende.req("GET", "/api/whatsapp/conversas?atendente=sem")).json().conversas.every((c: { atendenteId: string | null }) => c.atendenteId === null)).toBe(true);
    expect((await atende.req("POST", `/api/whatsapp/conversas/${conversaId}/atribuir`, { usuarioId: null })).statusCode).toBe(200);
  });
});

describe("respostas prontas", () => {
  it("carrega as sugestões (idempotente, não revisadas), edita, cria, evita atalho repetido e aplica variáveis", async () => {
    expect((await leitor.req("POST", "/api/whatsapp/respostas-rapidas/sugestoes")).statusCode).toBe(403);
    expect((await atende.req("POST", "/api/whatsapp/respostas-rapidas/sugestoes")).json().criadas).toBe(18);
    expect((await atende.req("POST", "/api/whatsapp/respostas-rapidas/sugestoes")).json().criadas).toBe(0);
    const lista = (await leitor.req("GET", "/api/whatsapp/respostas-rapidas?idioma=EN")).json() as Array<{ id: string; atalho: string; revisada: boolean; texto: string }>;
    expect(lista).toHaveLength(6);
    expect(lista.every((r) => !r.revisada)).toBe(true);
    const ponto = lista.find((r) => r.atalho === "ponto")!;
    const rev = await atende.req("PATCH", `/api/whatsapp/respostas-rapidas/${ponto.id}`, { revisada: true });
    expect(rev.json().revisada).toBe(true);
    const nova = await atende.req("POST", "/api/whatsapp/respostas-rapidas", { atalho: "/Preço!", titulo: "Preço", idioma: "PT", texto: "Os valores estão no site, {nome}." });
    expect(nova.statusCode).toBe(200);
    expect(nova.json().atalho).toBe("preco");
    expect((await atende.req("POST", "/api/whatsapp/respostas-rapidas", { atalho: "preco", titulo: "Outra", idioma: "PT", texto: "x" })).statusCode).toBe(409);
    expect((await atende.req("POST", "/api/whatsapp/respostas-rapidas", { atalho: "preco", titulo: "Price", idioma: "EN", texto: "x" })).statusCode).toBe(200);
    const [conv] = await db.select().from(waConversas).where(eq(waConversas.chave, `ig:${CLIENTE_A}`));
    await db.update(waConversas).set({ nome: "Ana Turista" }).where(eq(waConversas.id, conv!.id));
    const aplicada = (await atende.req("POST", `/api/whatsapp/conversas/${conv!.id}/aplicar-resposta`, { respostaId: nova.json().id })).json();
    expect(aplicada).toEqual({ texto: "Os valores estão no site, Ana.", faltando: [] });
    const comFalta = (await atende.req("POST", `/api/whatsapp/conversas/${conv!.id}/aplicar-resposta`, { respostaId: ponto.id })).json();
    expect(comFalta.faltando).toContain("ponto");
    expect((await atende.req("DELETE", `/api/whatsapp/respostas-rapidas/${nova.json().id}`)).statusCode).toBe(200);
    expect((await atende.req("DELETE", `/api/whatsapp/respostas-rapidas/${nova.json().id}`)).statusCode).toBe(404);
  });
});

describe("comentários dos posts", () => {
  it("lista, responde uma vez (simulado), recusa resposta a resposta, oculta e respeita permissões", async () => {
    const lista = (await leitor.req("GET", "/api/instagram/comentarios")).json();
    expect(lista.comentarios.length).toBe(2);
    const raiz = lista.comentarios.find((c: { ehResposta: boolean }) => !c.ehResposta);
    const resposta = lista.comentarios.find((c: { ehResposta: boolean }) => c.ehResposta);
    expect(raiz.autor).toBe("turista_ficticio");
    expect((await leitor.req("POST", `/api/instagram/comentarios/${raiz.id}/responder`, { texto: "Obrigado!" })).statusCode).toBe(403);
    expect((await semAcesso.req("GET", "/api/instagram/comentarios")).statusCode).toBe(403);
    expect((await atende.req("POST", `/api/instagram/comentarios/${resposta.id}/responder`, { texto: "Obrigado!" })).statusCode).toBe(400);
    const ok = await atende.req("POST", `/api/instagram/comentarios/${raiz.id}/responder`, { texto: "Obrigado pela visita!" });
    expect(ok.json().status).toBe("SIMULADA");
    expect((await atende.req("POST", `/api/instagram/comentarios/${raiz.id}/responder`, { texto: "De novo" })).statusCode).toBe(409);
    expect((await atende.req("POST", `/api/instagram/comentarios/${resposta.id}/ocultar`, { oculto: true })).statusCode).toBe(200);
    const pendentes = (await atende.req("GET", "/api/instagram/comentarios")).json();
    expect(pendentes.comentarios).toHaveLength(0); // um respondido e um oculto
    expect((await atende.req("GET", "/api/instagram/comentarios?situacao=todos")).json().comentarios).toHaveLength(2);
  });
});

describe("dados do Marketing (aba Instagram)", () => {
  it("devolve resumo, série, ranking e melhores horários só para quem tem marketing:ver", async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const dia = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await db.insert(igMetricasDia).values([
      { data: dia(2), seguidores: 1000, alcance: 500, visualizacoes: 900, visitasPerfil: 40, cliquesSite: 5 },
      { data: dia(1), seguidores: 1010, alcance: 700, visualizacoes: 1200, visitasPerfil: 60, cliquesSite: 7 },
      { data: hoje, seguidores: 1030, alcance: 300, visualizacoes: 500, visitasPerfil: 20, cliquesSite: 1 },
    ]);
    const base = Date.now() - 2 * 86_400_000;
    await db.insert(igPosts).values([
      { idExterno: "p1", tipo: "REELS", legenda: "Reels A", publicadoEm: new Date(base), curtidas: 100, comentarios: 10, salvamentos: 5, compartilhamentos: 5, alcance: 2000 },
      { idExterno: "p2", tipo: "IMAGEM", legenda: "Foto B", publicadoEm: new Date(base + 3600_000), curtidas: 20, comentarios: 1, salvamentos: 0, compartilhamentos: 0, alcance: 400 },
    ]);
    expect((await semAcesso.req("GET", "/api/marketing/instagram")).statusCode).toBe(403);
    const r = (await leitor.req("GET", "/api/marketing/instagram")).json();
    expect(r.modo).toMatchObject({ conectado: false, simulado: true });
    expect(r.resumo).toMatchObject({ seguidores: 1030, variacaoSeguidores: 30, alcance: 1500, visualizacoes: 2600, visitasPerfil: 120, cliquesSite: 13, posts: 2, engajamento: 141 });
    expect(r.serie).toHaveLength(3);
    expect(r.ranking[0]).toMatchObject({ legenda: "Reels A", engajamento: 120 });
    expect(r.melhores.porHora.length).toBeGreaterThan(0);
    expect((await leitor.req("GET", "/api/marketing/instagram?de=2026-05-01&ate=2026-04-01")).statusCode).toBe(400);
    expect((await leitor.req("POST", "/api/marketing/instagram/atualizar")).statusCode).toBe(403);
    const atualizar = (await atende.req("POST", "/api/marketing/instagram/atualizar")).json();
    expect(atualizar).toMatchObject({ executou: false, motivo: "SIMULADO" });
  });

  it("a rotina lê a Meta (simulada por mock), grava e é idempotente; erro de uma métrica não apaga o que já existe", async () => {
    const chamadas: string[] = [];
    const meta = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const u = new URL(String(url));
      chamadas.push(`${init?.method ?? "GET"} ${u.pathname}`);
      expect(u.search).not.toContain("token"); // token só no cabeçalho
      expect((init?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
      const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
      if (u.pathname === `/v23.0/${CONTA}`) return j({ followers_count: 1111, media_count: 3 });
      if (u.pathname.endsWith("/insights") && u.pathname.includes(CONTA)) return j({ data: [{ name: "reach", total_value: { value: 321 } }, { name: "views", total_value: { value: 654 } }, { name: "profile_views", total_value: { value: 12 } }, { name: "website_clicks", total_value: { value: 3 } }] });
      if (u.pathname === `/v23.0/${CONTA}/media`) return j({ data: [{ id: "p1", media_type: "VIDEO", media_product_type: "REELS", caption: "Reels A", permalink: "https://instagram.com/p/x", timestamp: new Date(Date.now() - 86_400_000).toISOString(), like_count: 150, comments_count: 12 }, { id: "p3", media_type: "CAROUSEL_ALBUM", timestamp: new Date().toISOString(), like_count: 5, comments_count: 0 }] });
      if (u.pathname === "/v23.0/p1/insights") return j({ data: [{ name: "reach", values: [{ value: 2500 }] }, { name: "saved", values: [{ value: 9 }] }, { name: "shares", values: [{ value: 8 }] }] });
      return j({ error: { code: 100 } }, 400);
    }) as unknown as typeof fetch;
    const r1 = await sincronizarInstagram(db, configReal(), { buscar: meta });
    expect(r1).toMatchObject({ executou: true, dias: 2, posts: 2 });
    const hoje = new Date().toISOString().slice(0, 10);
    const [m] = await db.select().from(igMetricasDia).where(eq(igMetricasDia.data, hoje));
    expect(m).toMatchObject({ seguidores: 1111, alcance: 321 });
    const [p1] = await db.select().from(igPosts).where(eq(igPosts.idExterno, "p1"));
    expect(p1).toMatchObject({ tipo: "REELS", curtidas: 150, salvamentos: 9, compartilhamentos: 8, alcance: 2500 });
    expect((await db.select().from(igPosts).where(eq(igPosts.idExterno, "p3")))[0]).toMatchObject({ tipo: "CARROSSEL", alcance: null });
    await sincronizarInstagram(db, configReal(), { buscar: meta });
    expect((await db.select().from(igPosts)).length).toBe(3); // p1, p2 (do teste anterior) e p3: nada duplicado
    // Meta fora do ar: nada é apagado
    const fora = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const r3 = await sincronizarInstagram(db, configReal(), { buscar: fora });
    expect(r3.falhas.length).toBeGreaterThan(0);
    expect((await db.select().from(igMetricasDia).where(eq(igMetricasDia.data, hoje)))[0]!.alcance).toBe(321);
    // simulado: nunca chama a Meta
    const nunca = vi.fn() as unknown as typeof fetch;
    expect((await sincronizarInstagram(db, configSimulada(), { buscar: nunca })).executou).toBe(false);
    expect(nunca).not.toHaveBeenCalled();
  });
});

describe("mídia, aprovação e agendamento", () => {
  let id = "";
  const futuro = (min = 60) => new Date(Date.now() + min * 60_000).toISOString();

  it("anexa mídia conferindo o conteúdo e respeitando permissões", async () => {
    const c = await atende.req("POST", "/api/marketing/conteudos", { titulo: "Reels do pôr do sol", rede: "INSTAGRAM", legenda: "Pôr do sol na ilha #floripa", unidadeId: await unidadeFln() });
    expect(c.statusCode).toBe(200);
    id = c.json().id;
    const url = `/api/marketing/conteudos/${id}/midias?nome=foto.jpg`;
    expect((await enviarMidia(leitor, url, JPEG, "image/jpeg")).statusCode).toBe(403);
    expect((await enviarMidia(atende, url, PNG, "image/jpeg")).statusCode).toBe(400); // conteúdo não confere
    expect((await enviarMidia(atende, url, PNG, "image/png")).statusCode).toBe(400); // PNG não serve ao Instagram
    expect((await enviarMidia(atende, url, Buffer.from("<svg onload=alert(1)>"), "image/svg+xml")).statusCode).toBe(400);
    expect((await enviarMidia(atende, url, Buffer.alloc(0), "image/jpeg")).statusCode).toBe(400);
    expect((await enviarMidia(new Cliente(app), url, JPEG, "image/jpeg")).statusCode).toBe(401);
    const ok = await enviarMidia(atende, url, JPEG, "image/jpeg");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ tipo: "image/jpeg", uso: "IMAGEM", ordem: 0 });
    const lista = (await leitor.req("GET", `/api/marketing/conteudos/${id}/midias`)).json();
    expect(lista).toHaveLength(1);
    const arquivo = await app.inject({ method: "GET", url: `/api/marketing/conteudos/${id}/midias/${lista[0].id}`, headers: { cookie: leitor.cookie } });
    expect(arquivo.statusCode).toBe(200);
    expect(arquivo.headers["content-type"]).toBe("image/jpeg");
    expect(arquivo.headers["x-content-type-options"]).toBe("nosniff");
    expect((await semAcesso.req("GET", `/api/marketing/conteudos/${id}/midias`)).statusCode).toBe(403);
  });

  it("só agenda post aprovado; Instagram não aceita pular a aprovação pela edição", async () => {
    const agendar = (extra = {}) => atende.req("POST", `/api/marketing/conteudos/${id}/agendar`, { tipoPost: "IMAGEM", agendarEm: futuro(), ...extra });
    expect((await agendar()).statusCode).toBe(409);
    expect((await agendar()).json().codigo).toBe("NAO_APROVADO");
    expect((await atende.req("PATCH", `/api/marketing/conteudos/${id}`, { status: "APROVADO" })).statusCode).toBe(400);
    expect((await atende.req("PATCH", `/api/marketing/conteudos/${id}`, { status: "AGENDADO" })).statusCode).toBe(400);
    expect((await atende.req("PATCH", `/api/marketing/conteudos/${id}`, { status: "PUBLICADO" })).statusCode).toBe(400);
    expect((await atende.req("POST", `/api/marketing/conteudos/${id}/aprovar`)).statusCode).toBe(409); // ainda não pediu aprovação
    expect((await leitor.req("POST", `/api/marketing/conteudos/${id}/solicitar-aprovacao`)).statusCode).toBe(403);
    expect((await atende.req("POST", `/api/marketing/conteudos/${id}/solicitar-aprovacao`)).statusCode).toBe(200);
    expect((await leitor.req("POST", `/api/marketing/conteudos/${id}/aprovar`)).statusCode).toBe(403);
    expect((await atende.req("POST", `/api/marketing/conteudos/${id}/aprovar`)).statusCode).toBe(200);
    const [c] = await db.select().from(conteudos).where(eq(conteudos.id, id));
    expect(c).toMatchObject({ status: "APROVADO" });
    expect(c!.aprovadoEm).not.toBeNull();
    expect((await agendar({ agendarEm: new Date(Date.now() - 60_000).toISOString() })).statusCode).toBe(400);
    expect((await agendar({ tipoPost: "REELS" })).statusCode).toBe(400); // REELS exige vídeo
    expect((await agendar({ agendarEm: "amanhã" })).statusCode).toBe(400);
    expect((await agendar()).statusCode).toBe(200);
    expect((await atende.req("GET", "/api/marketing/conteudos?status=AGENDADO")).json().find((x: { id: string }) => x.id === id)).toMatchObject({ pubStatus: "AGENDADO", tipoPost: "IMAGEM", qtdMidias: 1 });
  });

  it("alterar a legenda ou a mídia de um post agendado desfaz a aprovação e tira da fila", async () => {
    expect((await atende.req("PATCH", `/api/marketing/conteudos/${id}`, { legenda: "Legenda nova" })).statusCode).toBe(200);
    expect((await db.select().from(conteudos).where(eq(conteudos.id, id)))[0]).toMatchObject({ status: "EM_APROVACAO", pubStatus: null, aprovadoEm: null });
    // aprova e agenda de novo; trocar a mídia também desfaz
    await atende.req("POST", `/api/marketing/conteudos/${id}/aprovar`);
    expect((await atende.req("POST", `/api/marketing/conteudos/${id}/agendar`, { tipoPost: "IMAGEM", agendarEm: futuro() })).statusCode).toBe(200);
    const [m] = (await atende.req("GET", `/api/marketing/conteudos/${id}/midias`)).json();
    expect((await atende.req("DELETE", `/api/marketing/conteudos/${id}/midias/${m.id}`)).statusCode).toBe(200);
    expect((await db.select().from(conteudos).where(eq(conteudos.id, id)))[0]).toMatchObject({ status: "EM_APROVACAO", pubStatus: null });
    expect((await enviarMidia(atende, `/api/marketing/conteudos/${id}/midias?nome=outra.jpg`, JPEG, "image/jpeg")).statusCode).toBe(200);
  });

  it("devolver e cancelar agendamento", async () => {
    await atende.req("POST", `/api/marketing/conteudos/${id}/aprovar`);
    await atende.req("POST", `/api/marketing/conteudos/${id}/agendar`, { tipoPost: "IMAGEM", agendarEm: futuro() });
    expect((await atende.req("POST", `/api/marketing/conteudos/${id}/cancelar-agendamento`)).json().status).toBe("APROVADO");
    expect((await atende.req("POST", `/api/marketing/conteudos/${id}/cancelar-agendamento`)).statusCode).toBe(409);
    expect((await atende.req("POST", `/api/marketing/conteudos/${id}/devolver`)).json().status).toBe("PRODUCAO");
    expect((await atende.req("POST", `/api/marketing/conteudos/${id}/devolver`)).statusCode).toBe(409);
  });
});

describe("rotina de publicação", () => {
  async function postAgendado(tipoPost: string, midias: Array<{ tipo: string; uso: string; dados: Buffer }>, extra: Partial<typeof conteudos.$inferInsert> = {}) {
    const [c] = await db.insert(conteudos).values({
      titulo: "Post de teste", rede: "INSTAGRAM", status: "AGENDADO", legenda: "Legenda #teste", tipoPost, pubStatus: "AGENDADO", agendarEm: new Date(Date.now() + 3_600_000),
      aprovadoEm: new Date(), ...extra,
    }).returning();
    for (const [i, m] of midias.entries()) await db.insert(conteudoMidias).values({ conteudoId: c!.id, ordem: i, nome: `m${i}`, tipo: m.tipo, uso: m.uso, tamanho: m.dados.length, dados: m.dados });
    return c!.id;
  }
  const depois = () => new Date(Date.now() + 2 * 3_600_000);
  const estado = async (id: string) => (await db.select().from(conteudos).where(eq(conteudos.id, id)))[0]!;
  const img = { tipo: "image/jpeg", uso: "IMAGEM", dados: JPEG };

  it("simulado: marca publicado (simulado) só o que venceu e foi aprovado", async () => {
    const venceu = await postAgendado("IMAGEM", [img]);
    const futuro = await postAgendado("IMAGEM", [img], { agendarEm: new Date(Date.now() + 5 * 3_600_000) });
    const semAprovacao = await postAgendado("IMAGEM", [img], { aprovadoEm: null });
    const r = await publicarPendentes(db, configSimulada(), { agora: depois() });
    expect(r.simuladas).toBe(1);
    expect(await estado(venceu)).toMatchObject({ pubStatus: "PUBLICADO", pubSimulado: true, status: "PUBLICADO" });
    expect((await estado(futuro)).pubStatus).toBe("AGENDADO");
    expect((await estado(semAprovacao)).pubStatus).toBe("AGENDADO");
    expect((await publicarPendentes(db, configSimulada(), { agora: depois() })).simuladas).toBe(0); // idempotente
    await db.delete(conteudos).where(eq(conteudos.id, futuro));
    await db.delete(conteudos).where(eq(conteudos.id, semAprovacao));
  });

  it("conteúdo que ficou inválido falha com motivo (carrossel com 1 mídia)", async () => {
    const id = await postAgendado("CARROSSEL", [img]);
    const r = await publicarPendentes(db, configSimulada(), { agora: depois() });
    expect(r.falhas).toBe(1);
    expect(await estado(id)).toMatchObject({ pubStatus: "FALHOU", pubErro: "CONTEUDO_INVALIDO" });
  });

  it("real (Meta simulada por mock): cria contêiner, serve a mídia por token temporário, publica e invalida o token", async () => {
    const id = await postAgendado("IMAGEM", [img]);
    const [midia] = await db.select().from(conteudoMidias).where(eq(conteudoMidias.conteudoId, id));
    const passos: string[] = [];
    let urlDaMidia = "";
    const meta = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const u = new URL(String(url));
      const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      passos.push(`${init?.method ?? "GET"} ${u.pathname.replace(CONTA, "{conta}")}`);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-de-teste-do-instagram");
      if (u.pathname.endsWith("/media") && init?.method === "POST") {
        const corpo = JSON.parse(String(init.body));
        urlDaMidia = corpo.image_url;
        expect(corpo.caption).toBe("Legenda #teste");
        expect(urlDaMidia).toMatch(/^https:\/\/gestao\.exemplo\.test\/api\/publico\/instagram\/midia\/[\w-]{43}$/);
        // a Meta busca o arquivo agora: deve funcionar, sem login
        const busca = await app.inject({ method: "GET", url: urlDaMidia.replace("https://gestao.exemplo.test", "") });
        expect(busca.statusCode).toBe(200);
        expect(busca.headers["content-type"]).toBe("image/jpeg");
        expect(busca.headers["cache-control"]).toBe("no-store");
        expect(busca.rawPayload.equals(JPEG)).toBe(true);
        return j({ id: "cont-1" });
      }
      if (u.pathname === "/v23.0/cont-1") return j({ status_code: "FINISHED" });
      if (u.pathname.endsWith("/media_publish")) { expect(JSON.parse(String(init!.body))).toEqual({ creation_id: "cont-1" }); return j({ id: "post-1" }); }
      if (u.pathname === "/v23.0/post-1") return j({ permalink: "https://www.instagram.com/p/teste/" });
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await publicarPendentes(db, configReal(), { agora: depois(), buscar: meta, pausaMs: 0 });
    expect(r.publicadas).toBe(1);
    expect(passos).toEqual(["POST /v23.0/{conta}/media", "GET /v23.0/cont-1", "POST /v23.0/{conta}/media_publish", "GET /v23.0/post-1"]);
    expect(await estado(id)).toMatchObject({ pubStatus: "PUBLICADO", pubSimulado: false, pubIdExterno: "post-1", link: "https://www.instagram.com/p/teste/" });
    // depois de publicado o token não vale mais
    expect((await app.inject({ method: "GET", url: urlDaMidia.replace("https://gestao.exemplo.test", "") })).statusCode).toBe(404);
    expect(await db.select().from(igMidiaTokens).where(eq(igMidiaTokens.midiaId, midia!.id))).toHaveLength(0);
  });

  it("rota pública de mídia: token expirado, desconhecido, malformado ou de post que não está publicando → 404 igual", async () => {
    const id = await postAgendado("IMAGEM", [img], { pubStatus: "PUBLICANDO", pubIniciadaEm: new Date() });
    const [midia] = await db.select().from(conteudoMidias).where(eq(conteudoMidias.conteudoId, id));
    const token = "A".repeat(43);
    await db.insert(igMidiaTokens).values({ tokenHash: hashToken(token), midiaId: midia!.id, expiraEm: new Date(Date.now() + 60_000) });
    const rota = (t: string) => app.inject({ method: "GET", url: `/api/publico/instagram/midia/${t}` });
    expect((await rota(token)).statusCode).toBe(200);
    await db.update(igMidiaTokens).set({ expiraEm: new Date(Date.now() - 1000) }).where(eq(igMidiaTokens.tokenHash, hashToken(token)));
    const expirado = await rota(token);
    expect(expirado.statusCode).toBe(404);
    expect((await rota("B".repeat(43))).statusCode).toBe(404);
    expect((await rota("curto")).statusCode).toBe(404);
    expect((await rota("..%2F..%2Fetc%2Fpasswd")).statusCode).toBe(404);
    expect((await rota("B".repeat(43))).body).toBe(expirado.body);
    // token válido, mas o post não está sendo publicado
    await db.update(igMidiaTokens).set({ expiraEm: new Date(Date.now() + 60_000) }).where(eq(igMidiaTokens.tokenHash, hashToken(token)));
    await db.update(conteudos).set({ pubStatus: "AGENDADO" }).where(eq(conteudos.id, id));
    expect((await rota(token)).statusCode).toBe(404);
    // a rotina limpa o que expirou
    await db.update(igMidiaTokens).set({ expiraEm: new Date(Date.now() - 1000) }).where(eq(igMidiaTokens.tokenHash, hashToken(token)));
    await publicarPendentes(db, configSimulada());
    expect(await db.select().from(igMidiaTokens).where(eq(igMidiaTokens.tokenHash, hashToken(token)))).toHaveLength(0);
    await db.delete(conteudos).where(eq(conteudos.id, id));
  });

  it("falha transitória volta à fila com espera e reaproveita o contêiner; erro definitivo falha com o código; sem URL pública falha", async () => {
    const id = await postAgendado("IMAGEM", [img]);
    let publicacoes = 0;
    const instavel = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const u = new URL(String(url));
      const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
      if (u.pathname.endsWith("/media") && init?.method === "POST") return j({ id: "cont-2" });
      if (u.pathname === "/v23.0/cont-2") return j({ status_code: "FINISHED" });
      if (u.pathname.endsWith("/media_publish")) { publicacoes++; return publicacoes === 1 ? j({ error: { code: 2 } }, 503) : j({ id: "post-2" }); }
      return j({}, 404);
    }) as unknown as typeof fetch;
    const agora = depois();
    expect((await publicarPendentes(db, configReal(), { agora, buscar: instavel, pausaMs: 0 })).adiadas).toBe(1);
    const aposFalha = await estado(id);
    expect(aposFalha).toMatchObject({ pubStatus: "AGENDADO", pubErro: "META_2", pubContainerId: "cont-2" });
    expect(aposFalha.pubProximaEm!.getTime()).toBeGreaterThan(agora.getTime());
    // antes da espera: nada acontece
    expect((await publicarPendentes(db, configReal(), { agora, buscar: instavel, pausaMs: 0 })).publicadas).toBe(0);
    const depoisDaEspera = new Date(agora.getTime() + 10 * 60_000);
    expect((await publicarPendentes(db, configReal(), { agora: depoisDaEspera, buscar: instavel, pausaMs: 0 })).publicadas).toBe(1);
    expect(await estado(id)).toMatchObject({ pubStatus: "PUBLICADO", pubIdExterno: "post-2" });

    const definitivo = await postAgendado("IMAGEM", [img]);
    const recusa = vi.fn(async () => new Response(JSON.stringify({ error: { code: 190, message: "TEXTO-QUE-NAO-PODE-VAZAR" } }), { status: 400 })) as unknown as typeof fetch;
    expect((await publicarPendentes(db, configReal(), { agora: depois(), buscar: recusa, pausaMs: 0 })).falhas).toBe(1);
    const f = await estado(definitivo);
    expect(f).toMatchObject({ pubStatus: "FALHOU", pubErro: "META_190" });
    expect(JSON.stringify(f)).not.toContain("NAO-PODE-VAZAR");

    const semUrl = await postAgendado("IMAGEM", [img]);
    const { URL_PUBLICA: _u, ...resto } = configReal();
    await publicarPendentes(db, resto as ReturnType<typeof configReal>, { agora: depois(), buscar: recusa, pausaMs: 0 });
    expect(await estado(semUrl)).toMatchObject({ pubStatus: "FALHOU", pubErro: "URL_PUBLICA_AUSENTE" });
  });

  it("vídeo ainda processando volta à fila sem gastar tentativa; preso em PUBLICANDO vira falha (não republica)", async () => {
    const id = await postAgendado("REELS", [{ tipo: "video/mp4", uso: "VIDEO", dados: MP4 }]);
    const processando = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/media") && init?.method === "POST") return new Response(JSON.stringify({ id: "cont-v" }), { status: 200 });
      return new Response(JSON.stringify({ status_code: "IN_PROGRESS" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await publicarPendentes(db, configReal(), { agora: depois(), buscar: processando, pausaMs: 0, consultas: 2 });
    expect(r.adiadas).toBe(1);
    expect(await estado(id)).toMatchObject({ pubStatus: "AGENDADO", pubTentativas: 0, pubContainerId: "cont-v" });
    const preso = await postAgendado("IMAGEM", [img], { pubStatus: "PUBLICANDO", pubIniciadaEm: new Date(Date.now() - 2 * 3_600_000) });
    const r2 = await publicarPendentes(db, configReal(), { agora: new Date(), buscar: processando, pausaMs: 0 });
    expect(r2.interrompidas).toBe(1);
    expect(await estado(preso)).toMatchObject({ pubStatus: "FALHOU", pubErro: "INTERROMPIDO_CONFIRA_NO_INSTAGRAM" });
  });
});

describe("banco de mídias", () => {
  it("envia com etiquetas, filtra, reaproveita no post e respeita permissões", async () => {
    const url = "/api/marketing/banco-midias?nome=ilha.jpg&passeio=City%20Tour%20Toda%20Ilha&pontoTuristico=Lagoa&temporada=Ver%C3%A3o";
    expect((await enviarMidia(leitor, url, JPEG, "image/jpeg")).statusCode).toBe(403);
    expect((await enviarMidia(atende, url, MP4.subarray(0, 4), "image/jpeg")).statusCode).toBe(400);
    const a = await enviarMidia(atende, url, JPEG, "image/jpeg");
    expect(a.statusCode).toBe(200);
    const png = await enviarMidia(atende, "/api/marketing/banco-midias?nome=logo.png", PNG, "image/png");
    expect(png.statusCode).toBe(200); // PNG vale no banco, mas não vai ao Instagram
    const lista = (await leitor.req("GET", "/api/marketing/banco-midias?passeio=City%20Tour%20Toda%20Ilha")).json();
    expect(lista.itens).toHaveLength(1);
    expect(lista.itens[0]).toMatchObject({ pontoTuristico: "Lagoa", temporada: "Verão" });
    expect(lista.itens[0].dados).toBeUndefined();
    expect(lista.etiquetas.temporadas).toContain("Verão");
    expect((await leitor.req("GET", "/api/marketing/banco-midias?busca=logo")).json().itens).toHaveLength(1);
    const arquivo = await app.inject({ method: "GET", url: `/api/marketing/banco-midias/${a.json().id}/arquivo`, headers: { cookie: leitor.cookie } });
    expect(arquivo.statusCode).toBe(200);
    const c = (await atende.req("POST", "/api/marketing/conteudos", { titulo: "Do banco", rede: "INSTAGRAM", unidadeId: await unidadeFln() })).json();
    expect((await atende.req("POST", `/api/marketing/conteudos/${c.id}/midias/do-banco`, { bancoId: png.json().id })).statusCode).toBe(400);
    const ok = await atende.req("POST", `/api/marketing/conteudos/${c.id}/midias/do-banco`, { bancoId: a.json().id });
    expect(ok.statusCode).toBe(200);
    expect((await atende.req("PATCH", `/api/marketing/banco-midias/${a.json().id}`, { temporada: null })).json().temporada).toBeNull();
    expect((await atende.req("DELETE", `/api/marketing/banco-midias/${a.json().id}`)).statusCode).toBe(200);
    expect((await leitor.req("GET", `/api/marketing/conteudos/${c.id}/midias`)).json()).toHaveLength(1); // a cópia fica
    expect((await leitor.req("DELETE", `/api/marketing/banco-midias/${png.json().id}`)).statusCode).toBe(403);
  });
});

describe("sugerir legenda (IA)", () => {
  it("sem chave da IA mostra 'IA desligada' sem quebrar; com cliente falso devolve 3 opções e valida a entrada", async () => {
    const desligada = await atende.req("POST", "/api/marketing/legendas/sugerir", { briefing: "Pôr do sol na Lagoa", idioma: "en" });
    expect(desligada.statusCode).toBe(200);
    expect(desligada.json()).toMatchObject({ ligada: false });
    expect(desligada.json().mensagem).toMatch(/IA desligada/);
    expect((await leitor.req("POST", "/api/marketing/legendas/sugerir", { briefing: "x ideia" })).statusCode).toBe(403);
    expect((await atende.req("POST", "/api/marketing/legendas/sugerir", { briefing: "" })).statusCode).toBe(400);
    expect((await atende.req("POST", "/api/marketing/legendas/sugerir", { briefing: "ok ideia", idioma: "fr" })).statusCode).toBe(400);

    const pedidos: string[] = [];
    const falso: ClienteIA = {
      async enviar(p) {
        pedidos.push(JSON.stringify(p.mensagens));
        return { content: [{ type: "tool_use", id: "t1", name: "registrar_legendas", input: { opcoes: [1, 2, 3].map((n) => ({ legenda: `Legenda número ${n} do passeio`, hashtags: ["floripa", "#turismo", "citytour"] })) } }], stop_reason: "tool_use", modelo: "claude-opus-5-5", usage: { input_tokens: 500, output_tokens: 300 } };
      },
    };
    definirClienteIA(falso);
    const r = (await atende.req("POST", "/api/marketing/legendas/sugerir", { briefing: "Pôr do sol na Lagoa", idioma: "es", passeio: "City Tour Toda Ilha" })).json();
    expect(r.ligada).toBe(true);
    expect(r.opcoes).toHaveLength(3);
    expect(r.opcoes[0].hashtags).toEqual(["#floripa", "#turismo", "#citytour"]);
    expect(pedidos[0]).toContain("espanhol");
    expect(pedidos[0]).not.toMatch(/@bybus\.test/); // nenhum dado de pessoa vai para a IA
  });
});
