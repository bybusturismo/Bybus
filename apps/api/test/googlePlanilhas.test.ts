import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { esquecerTokenGoogle, idDaPlanilha } from "../src/servicos/googlePlanilhas.js";
import { Cliente, prepararBanco, subirApp } from "./ajuda.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const CONTA = { client_email: "leitor@projeto-ficticio.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const LINK = "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0";
let app: FastifyInstance;
let fechar: () => Promise<void>;
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ GOOGLE_CONTA_SERVICO: Buffer.from(JSON.stringify(CONTA)).toString("base64") }));
});
afterEach(() => { vi.unstubAllGlobals(); esquecerTokenGoogle(); });
afterAll(async () => fechar());

describe("importar a planilha pelo link do Google (conta de serviço)", () => {
  it("lê o ID do link", () => {
    expect(idDaPlanilha(LINK)).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
    expect(idDaPlanilha("https://exemplo.test/planilha")).toBeNull();
  });

  it("assina o pedido com a chave, lista as abas e devolve a aba em CSV", async () => {
    const chamadas: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        const assertion = new URLSearchParams(String(init!.body)).get("assertion")!;
        const [h, c, s] = assertion.split(".");
        expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
        expect(JSON.parse(Buffer.from(c!, "base64url").toString())).toMatchObject({ iss: CONTA.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly" });
        return json({ access_token: "token-ficticio", expires_in: 3600 });
      }
      if (url.includes("/values/")) return json({ values: [["DATA", "DESCRIÇÃO", "SICREDI"], ["01/10/2026", "Gelo, \"especial\"", "-R$ 40,00"]] });
      return json({ properties: { title: "DESP FIXA (fictícia)" }, sheets: [{ properties: { sheetId: 0, title: "OUTUBRO" } }, { properties: { sheetId: 7, title: "SETEMBRO" } }] });
    }));
    const admin = new Cliente(app);
    await admin.login("admin@bybus.test");
    expect((await admin.req("GET", "/api/financeiro/planilha/google")).json()).toEqual({ configurado: true, email: CONTA.client_email });
    const abas = (await admin.req("POST", "/api/financeiro/planilha/google/abas", { link: LINK })).json();
    expect(abas.abas.map((a: { titulo: string }) => a.titulo)).toEqual(["OUTUBRO", "SETEMBRO"]);
    const aba = (await admin.req("POST", "/api/financeiro/planilha/google/aba", { link: LINK, aba: "OUTUBRO" })).json();
    expect(aba).toEqual({ nome: "OUTUBRO.csv", texto: 'DATA,DESCRIÇÃO,SICREDI\n01/10/2026,"Gelo, ""especial""",-R$ 40,00'.replace("-R$ 40,00", '"-R$ 40,00"') });
    expect(chamadas.filter((u) => u.includes("oauth2")).length).toBe(1); // token reaproveitado
  });

  it("sem acesso à planilha explica como compartilhar com a conta de serviço", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("oauth2") ? json({ access_token: "t", expires_in: 3600 }) : json({ error: {} }, 403))));
    const admin = new Cliente(app);
    await admin.login("admin@bybus.test");
    const r = await admin.req("POST", "/api/financeiro/planilha/google/abas", { link: LINK });
    expect(r.statusCode).toBe(400);
    expect(r.json().mensagem).toContain(CONTA.client_email);
  });

  it("só quem gerencia o financeiro usa", async () => {
    const guia = new Cliente(app);
    await guia.login("guia@bybus.test");
    expect((await guia.req("POST", "/api/financeiro/planilha/google/abas", { link: LINK })).statusCode).toBe(403);
  });
});
