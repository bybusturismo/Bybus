import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { SENHA_DEMO } from "../src/db/ficticios.js";
import { auditoria, perfis, usuarios } from "../src/db/schema.js";
import { gerarHashSenha } from "../src/seguranca/senha.js";
import { Cliente, DATABASE_URL, diaSp, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
let admin: Cliente;
let gestor: Cliente;
let leitor: Cliente;
let semAcesso: Cliente;
let leitorId = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: { json: () => unknown }) => r.json() as any;
const PDF = Buffer.from("%PDF-1.4\n% documento fictício de teste\n").toString("base64");

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  const { db, pool } = criarDb(DATABASE_URL);
  const hash = await gerarHashSenha(SENHA_DEMO);
  const perfil = async (codigo: string, permissoes: string[]) => (await db.insert(perfis).values({ codigo, nome: codigo, permissoes }).returning())[0]!.id;
  const pGestor = await perfil("DOC_GESTOR", ["documentos:ver", "documentos:gerenciar"]);
  const pLeitor = await perfil("DOC_LEITOR", ["documentos:ver"]);
  const novo = async (email: string, perfilId: string) => (await db.insert(usuarios).values({ nome: email, email, perfilId, senhaHash: hash, trocarSenha: false }).returning())[0]!.id;
  await novo("doc.gestor@bybus.test", pGestor);
  leitorId = await novo("doc.leitor@bybus.test", pLeitor);
  await pool.end();
  const entrar = async (email: string) => { const c = new Cliente(app); expect((await c.login(email)).statusCode).toBe(200); return c; };
  admin = await entrar("admin@bybus.test");
  gestor = await entrar("doc.gestor@bybus.test");
  leitor = await entrar("doc.leitor@bybus.test");
  semAcesso = await entrar("atendente@bybus.test");
});
afterAll(async () => fechar());

describe("Documentos da empresa (11/11/2026)", () => {
  it("pastas iniciais: Societário e Sócios só para o administrador; quem não tem a permissão não entra", async () => {
    const a = json(await admin.req("GET", "/api/documentos"));
    expect(a.pastas.map((p: { nome: string }) => p.nome)).toEqual(["Societário", "Contratos", "Fiscal e licenças", "Sócios"]);
    expect(a.podeDefinirAcesso).toBe(true);
    const g = json(await gestor.req("GET", "/api/documentos"));
    expect(g.pastas.map((p: { nome: string }) => p.nome)).toEqual(["Contratos", "Fiscal e licenças"]);
    expect(g.pastas[0].usuarios).toBeUndefined(); // a lista de acesso só aparece para o administrador
    expect((await semAcesso.req("GET", "/api/documentos")).statusCode).toBe(403);
  });

  it("envia (cifrado), lista com vencimento, abre registrando na auditoria; pasta restrita some para quem não está na lista", async () => {
    const pastas = json(await admin.req("GET", "/api/documentos")).pastas as Array<{ id: string; nome: string }>;
    const contratos = pastas.find((p) => p.nome === "Contratos")!.id;
    const socios = pastas.find((p) => p.nome === "Sócios")!.id;
    const ontem = diaSp(-1);
    const r = await gestor.req("POST", "/api/documentos/arquivos", { pastaId: contratos, titulo: "Contrato fictício de aluguel", vencimento: ontem, nome: "aluguel.pdf", base64: PDF });
    expect(r.statusCode).toBe(201);
    const id = json(r).id;
    expect((await gestor.req("POST", "/api/documentos/arquivos", { pastaId: contratos, titulo: "Executável", nome: "x.exe", base64: Buffer.from("MZ....").toString("base64") })).statusCode).toBe(400);
    expect((await gestor.req("POST", "/api/documentos/arquivos", { pastaId: socios, titulo: "Não pode", nome: "a.pdf", base64: PDF })).statusCode).toBe(404);
    const lista = json(await leitor.req("GET", "/api/documentos"));
    expect(lista.arquivos[0]).toMatchObject({ titulo: "Contrato fictício de aluguel", situacao: "VENCIDO", mime: "application/pdf" });
    expect(lista.alertas).toHaveLength(1);
    const aberto = await leitor.req("GET", `/api/documentos/arquivos/${id}/conteudo`);
    expect(aberto.statusCode).toBe(200);
    expect(aberto.headers["content-disposition"]).toMatch(/^inline/);
    expect(aberto.body).toContain("documento fictício");
    expect((await leitor.req("DELETE", `/api/documentos/arquivos/${id}`)).statusCode).toBe(403);
    const { db, pool } = criarDb(DATABASE_URL);
    const reg = await db.select().from(auditoria).where(eq(auditoria.acao, "DOC_ABERTO"));
    const banco = await pool.query("select dados_cifrados from doc_arquivos where id = $1", [id]);
    await pool.end();
    expect(reg.some((x) => x.entidadeId === id)).toBe(true);
    expect(String(banco.rows[0].dados_cifrados)).not.toContain(PDF.slice(0, 12)); // guardado cifrado
  });

  it("só o administrador muda o acesso; incluir a pessoa na pasta restrita libera para ela", async () => {
    const pastas = json(await admin.req("GET", "/api/documentos")).pastas as Array<{ id: string; nome: string }>;
    const socios = pastas.find((p) => p.nome === "Sócios")!.id;
    expect((await gestor.req("PATCH", `/api/documentos/pastas/${socios}`, { usuarios: [leitorId] })).statusCode).toBe(404);
    const contratos = pastas.find((p) => p.nome === "Contratos")!.id;
    expect((await gestor.req("PATCH", `/api/documentos/pastas/${contratos}`, { acesso: "RESTRITO" })).statusCode).toBe(403);
    expect((await admin.req("PATCH", `/api/documentos/pastas/${socios}`, { usuarios: [leitorId] })).statusCode).toBe(200);
    expect(json(await leitor.req("GET", "/api/documentos")).pastas.map((p: { nome: string }) => p.nome)).toContain("Sócios");
    expect(json(await gestor.req("GET", "/api/documentos")).pastas.map((p: { nome: string }) => p.nome)).not.toContain("Sócios");
    const opcoes = json(await admin.req("GET", "/api/documentos/opcoes-acesso"));
    expect(opcoes.perfis.some((p: { codigo: string }) => p.codigo === "DOC_LEITOR")).toBe(true);
    expect((await gestor.req("GET", "/api/documentos/opcoes-acesso")).statusCode).toBe(403);
  });
});
