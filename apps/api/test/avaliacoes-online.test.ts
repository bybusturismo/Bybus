import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { avaliacaoExternas, configuracoes, marketingConfig, perfis, unidades, usuarios, usuariosUnidades } from "../src/db/schema.js";
import { SENHA_DEMO } from "../src/db/ficticios.js";
import { gerarHashSenha } from "../src/seguranca/senha.js";
import { Cofre } from "../src/seguranca/cripto.js";
import { lerConfig } from "../src/config.js";
import { definirBuscaAvaliacoes, sincronizarSeDevido } from "../src/servicos/avaliacoesOnline.js";
import { CHAVE, Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

const EXTRA = { GOOGLE_PERFIL_CLIENT_ID: "cliente-ficticio.apps.googleusercontent.com", GOOGLE_PERFIL_CLIENT_SECRET: "segredo-ficticio", TRIPADVISOR_API_KEY: "chave-ficticia-ta", URL_PUBLICA: "https://gestao.exemplo.test" };
let app: FastifyInstance;
let fechar: () => Promise<void>;
let semNada: { app: FastifyInstance; fechar: () => Promise<void> };
let FLN = "", BC = "";
const { db, pool } = criarDb(DATABASE_URL);
const LOCAL = "accounts/111/locations/222";

/** Google e Tripadvisor falsos: registra as chamadas e devolve respostas no formato das APIs. */
const chamadas: string[] = [];
let respostas = 0;
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const falso = (async (entrada: string | URL, init?: RequestInit) => {
  const url = String(entrada);
  chamadas.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
  if (url === "https://oauth2.googleapis.com/token") {
    const corpo = new URLSearchParams(String(init?.body));
    return corpo.get("grant_type") === "authorization_code" ? json({ refresh_token: "refresh-ficticio", access_token: "a1" }) : json({ access_token: "acesso-ficticio" });
  }
  if (url.startsWith("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")) return json({ accounts: [{ name: "accounts/111", accountName: "By Bus Turismo" }] });
  if (url.startsWith("https://mybusinessbusinessinformation.googleapis.com/v1/accounts/111/locations")) return json({ locations: [{ name: "locations/222", title: "Floripa by Bus" }] });
  if (url.startsWith(`https://mybusiness.googleapis.com/v4/${LOCAL}/reviews/`) && init?.method === "PUT") { respostas++; return json({ comment: JSON.parse(String(init.body)).comment }); }
  if (url.startsWith(`https://mybusiness.googleapis.com/v4/${LOCAL}/reviews`)) {
    return json({
      averageRating: 4.7, totalReviewCount: 812,
      reviews: [
        { name: `${LOCAL}/reviews/G1`, reviewId: "G1", reviewer: { displayName: "Turista Fictícia" }, starRating: "FIVE", comment: "Passeio lindo!", createTime: "2026-11-17T15:00:00Z" },
        { name: `${LOCAL}/reviews/G2`, reviewId: "G2", reviewer: { isAnonymous: true }, starRating: "TWO", comment: "(Original)\nÔnibus atrasou\n\n(Translated by Google)\nBus was late", createTime: "2026-11-16T12:00:00Z" },
        { name: `${LOCAL}/reviews/G3`, reviewId: "G3", reviewer: { displayName: "Outro Fictício" }, starRating: "FOUR", comment: "Bom", createTime: "2026-11-10T12:00:00Z", reviewReply: { comment: "Obrigado!", updateTime: "2026-11-11T12:00:00Z" } },
      ],
    });
  }
  if (url.startsWith("https://api.content.tripadvisor.com/api/v1/location/2362697/details")) {
    expect(new URL(url).searchParams.get("key")).toBe("chave-ficticia-ta");
    return json({ location_id: "2362697", rating: "4.5", num_reviews: "3456", web_url: "https://www.tripadvisor.com.br/Attraction_Review-g303576-d2362697", rating_image_url: "https://static.tacdn.com/img/ratings/4.5.svg" });
  }
  if (url.startsWith("https://api.content.tripadvisor.com/api/v1/location/2362697/reviews")) {
    const lang = new URL(url).searchParams.get("language");
    if (lang !== "pt") return json({ data: [] });
    return json({ data: [{ id: 9001, lang: "pt", rating: 5, title: "Excelente", text: "Guia ótimo", published_date: "2026-11-15T10:00:00Z", url: "https://www.tripadvisor.com.br/ShowUserReviews-9001", user: { username: "viajante_ficticio" } }] });
  }
  return json({ erro: "rota não simulada" }, 404);
}) as unknown as typeof fetch;

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp(EXTRA));
  semNada = await subirApp();
  const lista = await db.select().from(unidades);
  FLN = lista.find((u) => u.codigo === "FLN")!.id;
  BC = lista.find((u) => u.codigo === "BC")!.id;
  // link do Tripadvisor já cadastrado no Marketing (Floripa by Bus)
  await db.insert(marketingConfig).values({ chave: `link_tripadvisor_${FLN}`, valor: "https://www.tripadvisor.com.br/Attraction_Review-g303576-d2362697-Reviews-Floripa_by_Bus.html" }).onConflictDoNothing();
  const [perfil] = await db.insert(perfis).values({ codigo: "MKT_BC_AV", nome: "Marketing BC", permissoes: ["marketing:ver"] }).returning();
  const [u] = await db.insert(usuarios).values({ nome: "Marketing BC", email: "mkt.bc.av@bybus.test", perfilId: perfil!.id, senhaHash: await gerarHashSenha(SENHA_DEMO), trocarSenha: false }).returning();
  await db.insert(usuariosUnidades).values({ usuarioId: u!.id, unidadeId: BC });
  definirBuscaAvaliacoes(falso);
});
afterAll(async () => { definirBuscaAvaliacoes(null); await fechar(); await semNada.fechar(); await pool.end(); });
afterEach(() => { chamadas.length = 0; });

async function logado(a: FastifyInstance, email: string) {
  const c = new Cliente(a);
  expect((await c.login(email)).statusCode).toBe(200);
  return c;
}

describe("avaliações do Google e do Tripadvisor", () => {
  it("sem as chaves no servidor: a tela mostra o que falta e nada é chamado", async () => {
    const admin = await logado(semNada.app, "admin@bybus.test");
    const r = (await admin.req("GET", "/api/marketing/avaliacoes-online")).json();
    expect(r.estado).toEqual({ google: { configurado: false, conectado: false, retorno: null }, tripadvisor: { configurado: false } });
    expect((await admin.req("POST", "/api/marketing/avaliacoes-online/atualizar")).json().codigo).toBe("NADA_LIGADO");
    expect((await admin.req("GET", "/api/marketing/google/conectar")).json().codigo).toBe("GOOGLE_NAO_CONFIGURADO");
    expect(chamadas).toEqual([]);
  });

  it("conecta o Google (state amarrado), escolhe o local, lê as duas fontes, responde e atualiza a nota semanal", async () => {
    const admin = await logado(app, "admin@bybus.test");
    const { url } = (await admin.req("GET", "/api/marketing/google/conectar")).json();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("redirect_uri")).toBe("https://gestao.exemplo.test/api/marketing/google/retorno");
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/business.manage");
    // state errado não conecta
    expect((await admin.req("GET", "/api/marketing/google/retorno?code=x&state=inventado")).headers.location).toBe("/marketing/avaliacoes-online?google=erro");
    const volta = await admin.req("GET", `/api/marketing/google/retorno?code=codigo-ficticio&state=${u.searchParams.get("state")}`);
    expect(volta.headers.location).toBe("/marketing/avaliacoes-online?google=conectado");
    const [tok] = await db.select().from(configuracoes).where(eq(configuracoes.chave, "avaliacoes.google_token"));
    expect(tok!.valor).not.toContain("refresh-ficticio"); // guardado cifrado
    expect(new Cofre(CHAVE).decifrar(tok!.valor)).toBe("refresh-ficticio");
    // locais: o do Google é escolhido; o do Tripadvisor veio do link do Marketing
    expect((await admin.req("GET", "/api/marketing/google/locais")).json()).toEqual([{ nome: LOCAL, titulo: "Floripa by Bus", conta: "By Bus Turismo" }]);
    const locais = (await admin.req("PUT", "/api/marketing/avaliacoes-online/locais", { [FLN]: { google: LOCAL } })).json();
    expect(locais[FLN]).toMatchObject({ google: LOCAL, tripadvisor: "2362697" });
    // leitura
    const s = (await admin.req("POST", "/api/marketing/avaliacoes-online/atualizar")).json();
    expect(s.resultados).toEqual(expect.arrayContaining([
      expect.objectContaining({ canal: "GOOGLE", unidadeId: FLN, ok: true, novas: 3, media: 4.7, total: 812 }),
      expect.objectContaining({ canal: "TRIPADVISOR", unidadeId: FLN, ok: true, novas: 1, media: 4.5, total: 3456 }),
    ]));
    const v = (await admin.req("GET", `/api/marketing/avaliacoes-online?unidadeId=${FLN}`)).json();
    expect(v.itens.map((i: { idExterno: string }) => i.idExterno)).toEqual(["G1", "G2", "9001", "G3"]);
    const g2 = v.itens.find((i: { idExterno: string }) => i.idExterno === "G2");
    expect(g2).toMatchObject({ autor: null, nota: 2, texto: "Ônibus atrasou", resposta: null, lida: false });
    expect(v.resumo.find((r: { canal: string }) => r.canal === "GOOGLE")).toMatchObject({ media: 4.7, total: 812, novas: 3, guardadas: { quantidade: 3, semResposta: 1 } });
    expect(v.resumo.find((r: { canal: string }) => r.canal === "TRIPADVISOR")).toMatchObject({ media: 4.5, total: 3456, selo: "https://static.tacdn.com/img/ratings/4.5.svg" });
    // nota semanal da praça (antes lançada à mão)
    const notas = await db.select().from(avaliacaoExternas).where(eq(avaliacaoExternas.unidadeId, FLN));
    expect(notas.map((n) => [n.canal, n.notaCentesimos, n.quantidade]).sort()).toEqual([["GOOGLE", 470, 812], ["TRIPADVISOR", 450, 3456]]);
    // ler de novo não duplica nem conta como nova
    const s2 = (await admin.req("POST", "/api/marketing/avaliacoes-online/atualizar")).json();
    expect(s2.resultados.filter((r: { unidadeId: string }) => r.unidadeId === FLN).map((r: { novas: number }) => r.novas)).toEqual([0, 0]);
    // erro numa praça (BC: local que o Tripadvisor não reconhece) não impede a leitura das outras e aparece no resumo
    const deBc = s2.resultados.filter((r: { unidadeId: string }) => r.unidadeId === BC);
    expect(deBc.every((r: { ok: boolean; erro?: string }) => !r.ok && /Tripadvisor respondeu 404/.test(r.erro ?? ""))).toBe(true);
    expect((await db.select().from(avaliacaoExternas).where(eq(avaliacaoExternas.unidadeId, FLN))).length).toBe(2);
    // responder no Google; no Tripadvisor não dá
    const resp = await admin.req("POST", `/api/marketing/avaliacoes-online/${g2.id}/responder`, { texto: "Sentimos muito pelo atraso. Vamos melhorar." });
    expect(resp.statusCode, resp.body).toBe(200);
    expect(resp.json()).toMatchObject({ resposta: "Sentimos muito pelo atraso. Vamos melhorar.", lida: true });
    expect(respostas).toBe(1);
    expect(chamadas).toContain(`PUT https://mybusiness.googleapis.com/v4/${LOCAL}/reviews/G2/reply`);
    const ta = v.itens.find((i: { canal: string }) => i.canal === "TRIPADVISOR");
    expect((await admin.req("POST", `/api/marketing/avaliacoes-online/${ta.id}/responder`, { texto: "Obrigado" })).json().codigo).toBe("SO_GOOGLE");
    // marcar como lidas e filtrar novas / notas baixas
    expect((await admin.req("POST", "/api/marketing/avaliacoes-online/lidas", { ids: [ta.id] })).statusCode).toBe(200);
    expect((await admin.req("GET", `/api/marketing/avaliacoes-online?situacao=novas`)).json().itens.map((i: { idExterno: string }) => i.idExterno).sort()).toEqual(["G1", "G3"]);
    expect((await admin.req("GET", `/api/marketing/avaliacoes-online?notaAte=3`)).json().itens.map((i: { idExterno: string }) => i.idExterno)).toEqual(["G2"]);
    // outra praça não vê
    const bc = await logado(app, "mkt.bc.av@bybus.test");
    expect((await bc.req("GET", "/api/marketing/avaliacoes-online")).json().itens).toHaveLength(0);
    expect((await bc.req("POST", "/api/marketing/avaliacoes-online/atualizar")).statusCode).toBe(403);
  });

  it("leitura diária: só a partir das 7h e uma vez por dia", async () => {
    const config = lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: CHAVE, ...EXTRA });
    await db.delete(configuracoes).where(eq(configuracoes.chave, "avaliacoes.sincronia"));
    const cofre = new Cofre(CHAVE);
    expect(await sincronizarSeDevido(db, config, cofre, "06:59")).toBeNull();
    expect(await sincronizarSeDevido(db, config, cofre, "07:01")).not.toBeNull();
    expect(await sincronizarSeDevido(db, config, cofre, "15:00")).toBeNull();
  });
});
