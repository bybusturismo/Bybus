import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { cofreItens, usuarios } from "../src/db/schema.js";
import { SENHA_DEMO } from "../src/db/ficticios.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const { db, pool } = criarDb(DATABASE_URL);
let admin: Cliente;
let guia: Cliente;
let guiaId: string;
let setorId: string;

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp({ COFRE_CHAVE: "chave-do-cofre-ficticia-com-mais-de-32-caracteres" }));
  admin = new Cliente(app);
  await admin.login("admin@bybus.test");
  guia = new Cliente(app);
  await guia.login("guia@bybus.test");
  guiaId = (await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, "guia@bybus.test")))[0]!.id;
});
afterAll(async () => { await fechar(); await pool.end(); });

describe("cofre de senhas", () => {
  it("fica trancado até confirmar a própria senha", async () => {
    expect((await admin.req("GET", "/api/cofre/estado")).json()).toMatchObject({ configurado: true, aberto: false, gestor: true });
    expect((await admin.req("GET", "/api/cofre/itens")).statusCode).toBe(423);
    expect((await admin.req("POST", "/api/cofre/abrir", { senha: "errada" })).statusCode).toBe(400);
    expect((await admin.req("POST", "/api/cofre/abrir", { senha: SENHA_DEMO })).statusCode).toBe(200);
    expect((await admin.req("GET", "/api/cofre/estado")).json().aberto).toBe(true);
  });

  it("gestor cria setor; senha cifrada no banco; lista sem senha; revelar fica no registro", async () => {
    setorId = (await admin.req("POST", "/api/cofre/setores", { nome: "Marketing" })).json().id;
    const { id } = (await admin.req("POST", "/api/cofre/itens", { setorId, titulo: "Instagram Fictício", categoria: "Redes", usuario: "bybus.ficticio", senha: "Senha-Ficticia-123", notas: "Recuperação pelo e-mail fictício" })).json();
    const [i] = await db.select().from(cofreItens).where(eq(cofreItens.id, id));
    expect(i!.senhaCifrada).toMatch(/^v1:/);
    expect(i!.senhaCifrada).not.toContain("Senha-Ficticia-123");
    const lista = (await admin.req("GET", "/api/cofre/itens")).json();
    expect(lista.itens[0]).toMatchObject({ titulo: "Instagram Fictício", usuario: "bybus.ficticio", temSenha: true });
    expect(JSON.stringify(lista)).not.toContain("Senha-Ficticia-123");
    expect((await admin.req("POST", `/api/cofre/itens/${id}/revelar`, { campo: "senha", acao: "copiar" })).json().valor).toBe("Senha-Ficticia-123");
    const reg = (await admin.req("GET", "/api/cofre/registro")).json() as Array<{ acao: string }>;
    expect(reg.map((r) => r.acao)).toEqual(expect.arrayContaining(["entrar", "errou", "criar", "copiar"]));
  });

  it("setor só aparece para quem foi indicado; quem só vê não edita; só o gestor mexe em setores", async () => {
    expect((await guia.req("POST", "/api/cofre/abrir", { senha: SENHA_DEMO })).statusCode).toBe(200);
    expect((await guia.req("GET", "/api/cofre/itens")).json().setores).toEqual([]);
    expect((await guia.req("GET", "/api/cofre/setores")).statusCode).toBe(403);
    const admId = (await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, "admin@bybus.test")))[0]!.id;
    await admin.req("PATCH", `/api/cofre/setores/${setorId}`, { membros: [{ usuarioId: admId, podeEditar: true }, { usuarioId: guiaId, podeEditar: false }] });
    const l = (await guia.req("GET", "/api/cofre/itens")).json();
    expect(l.itens).toHaveLength(1);
    expect((await guia.req("POST", "/api/cofre/itens", { setorId, titulo: "Outro" })).statusCode).toBe(403);
    expect((await guia.req("POST", `/api/cofre/itens/${l.itens[0].id}/revelar`, {})).json().valor).toBe("Senha-Ficticia-123");
  });

  it("importa linhas já separadas, cifradas, e exclui", async () => {
    const r = (await admin.req("POST", "/api/cofre/itens/importar", { setorId, itens: [{ titulo: "Banco Fictício", categoria: "Bancos", usuario: "empresa", senha: "s1", notas: "Agência 0001" }, { titulo: "", senha: "x" }] })).json();
    expect(r.n).toBe(1);
    const itens = (await admin.req("GET", "/api/cofre/itens")).json().itens as Array<{ id: string; titulo: string }>;
    const banco = itens.find((i) => i.titulo === "Banco Fictício")!;
    expect((await admin.req("POST", "/api/cofre/itens/excluir", { ids: [banco.id] })).statusCode).toBe(200);
    expect(((await admin.req("GET", "/api/cofre/itens")).json().itens as unknown[]).length).toBe(1);
  });

  it("trancar fecha o Cofre", async () => {
    await admin.req("POST", "/api/cofre/fechar");
    expect((await admin.req("GET", "/api/cofre/itens")).statusCode).toBe(423);
  });
});
