import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { esquecerTokenGoogle, idDaPlanilha, idDoDrive } from "../src/servicos/googlePlanilhas.js";
import { criarDb } from "../src/db/cliente.js";
import { unidades } from "../src/db/schema.js";

import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

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
        expect(JSON.parse(Buffer.from(c!, "base64url").toString())).toMatchObject({ iss: CONTA.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly" });
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

describe("arquivos do Drive na ficha do veículo (gabaritos, 11/11/2026)", () => {
  const PASTA = "https://drive.google.com/drive/folders/1PastaFicticiaGabaritos0123?usp=sharing";
  it("lê o ID de links de pasta e de arquivo", () => {
    expect(idDoDrive(PASTA)).toBe("1PastaFicticiaGabaritos0123");
    expect(idDoDrive("https://drive.google.com/file/d/1ArquivoFicticio987654/view")).toBe("1ArquivoFicticio987654");
    expect(idDoDrive("https://exemplo.test/x")).toBeNull();
  });

  it("guarda o link, lista a pasta com subpastas e abre só arquivos dela", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("oauth2")) return json({ access_token: "t", expires_in: 3600 });
      if (url.includes("/files/1PastaFicticiaGabaritos0123?")) return json({ id: "1PastaFicticiaGabaritos0123", name: "Gabaritos ônibus fictício", mimeType: "application/vnd.google-apps.folder" });
      if (url.includes(encodeURIComponent("'1PastaFicticiaGabaritos0123' in parents"))) return json({ files: [
        { id: "1SubpastaFicticia000001", name: "Lateral", mimeType: "application/vnd.google-apps.folder" },
        { id: "1ArquivoFicticioFrente01", name: "frente.pdf", mimeType: "application/pdf", size: "1234", modifiedTime: "2026-11-01T10:00:00Z" },
      ] });
      if (url.includes(encodeURIComponent("'1SubpastaFicticia000001' in parents"))) return json({ files: [{ id: "1ArquivoFicticioLado02", name: "lado.png", mimeType: "image/png", size: "99" }] });
      if (url.includes("/files/1ArquivoFicticioFrente01?alt=media")) return new Response("%PDF-ficticio", { status: 200 });
      return json({ error: {} }, 404);
    }));
    const admin = new Cliente(app);
    await admin.login("admin@bybus.test");
    const { db, pool } = criarDb(DATABASE_URL);
    const fln = (await db.select().from(unidades)).find((u) => u.codigo === "FLN")!.id;
    await pool.end();
    const v = (await admin.req("POST", "/api/frota/veiculos", { unidadeId: fln, placa: "GAB1A23", tipo: "ONIBUS" })).json();
    expect((await admin.req("PATCH", `/api/frota/veiculos/${v.id}`, { driveLink: "https://exemplo.test/x" })).statusCode).toBe(400);
    expect((await admin.req("PATCH", `/api/frota/veiculos/${v.id}`, { driveLink: PASTA })).statusCode).toBe(200);
    const r = (await admin.req("GET", `/api/frota/veiculos/${v.id}/drive`)).json();
    expect(r).toMatchObject({ pasta: "Gabaritos ônibus fictício", email: CONTA.client_email });
    expect(r.itens.map((i: { nome: string; caminho: string }) => [i.caminho, i.nome])).toEqual([["", "frente.pdf"], ["Lateral", "lado.png"]]);
    const arq = await admin.req("GET", `/api/frota/veiculos/${v.id}/drive/1ArquivoFicticioFrente01`);
    expect(arq.statusCode).toBe(200);
    expect(arq.headers["content-type"]).toContain("application/pdf");
    expect(arq.headers["content-disposition"]).toMatch(/^inline/);
    // Arquivo que não é da pasta do veículo: recusado.
    expect((await admin.req("GET", `/api/frota/veiculos/${v.id}/drive/1OutroArquivoQualquer9`)).statusCode).toBe(404);
  });
});
