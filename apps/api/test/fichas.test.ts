import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { criarDb } from "../src/db/cliente.js";
import { usuarios, usuariosAnexos, usuariosFichas } from "../src/db/schema.js";
import { Cliente, DATABASE_URL, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const { db, pool } = criarDb(DATABASE_URL);
let guiaId: string;
let admin: Cliente;

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
  guiaId = (await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, "guia@bybus.test")))[0]!.id;
  admin = new Cliente(app);
  expect((await admin.login("admin@bybus.test")).statusCode).toBe(200);
});
afterAll(async () => { await fechar(); await pool.end(); });

const ficha = {
  apelido: "Guia", nascimento: "1990-05-20", telefone: "(48) 90000-0001", vinculo: "DIARISTA", cargo: "Guia de turismo", admissao: "2025-11-01", desligamento: null,
  cpf: "529.982.247-25", rg: "1234567", rgOrgao: "SSP/SC", cnpj: null, emailPessoal: "guia.ficticia@exemplo.test",
  endereco: { cep: "88000-000", logradouro: "Rua Fictícia", numero: "10", complemento: null, bairro: "Centro", cidade: "Florianópolis", uf: "SC" },
  emergencia: { nome: "Contato Fictício", parentesco: "Irmã", telefone: "(48) 90000-0002" },
  pix: { tipo: "CPF", chave: "52998224725" }, banco: { banco: null, agencia: null, conta: null }, anotacoes: "Fala espanhol.",
};

describe("ficha completa do usuário", () => {
  it("só quem tem a permissão vê e edita", async () => {
    const guia = new Cliente(app);
    await guia.login("guia@bybus.test");
    expect((await guia.req("GET", `/api/usuarios/${guiaId}/ficha`)).statusCode).toBe(403);
    expect((await guia.req("PUT", `/api/usuarios/${guiaId}/ficha`, ficha)).statusCode).toBe(403);
  });

  it("grava com os dados sensíveis cifrados e devolve abertos para quem pode", async () => {
    expect((await admin.req("PUT", `/api/usuarios/${guiaId}/ficha`, { ...ficha, cpf: "111.111.111-11" })).json().mensagem).toBe("CPF inválido.");
    expect((await admin.req("PUT", `/api/usuarios/${guiaId}/ficha`, { ...ficha, desligamento: "2025-01-01" })).statusCode).toBe(400);
    expect((await admin.req("PUT", `/api/usuarios/${guiaId}/ficha`, ficha)).statusCode).toBe(200);
    const [f] = await db.select().from(usuariosFichas).where(eq(usuariosFichas.usuarioId, guiaId));
    expect(f!.dadosCifrados).not.toContain("52998224725");
    expect(f!.dadosCifrados).not.toContain("Contato Fictício");
    const r = (await admin.req("GET", `/api/usuarios/${guiaId}/ficha`)).json();
    expect(r.ficha).toMatchObject({ vinculo: "DIARISTA", cpf: "52998224725", emergencia: { nome: "Contato Fictício", parentesco: "Irmã" }, endereco: { uf: "SC", cep: "88000000" } });
    expect(r.vinculos.length).toBeGreaterThan(3);
  });

  it("troca de Pix fica registrada", async () => {
    await admin.req("PUT", `/api/usuarios/${guiaId}/ficha`, { ...ficha, pix: { tipo: "ALEATORIA", chave: "nova-chave-ficticia" } });
    expect((await admin.req("GET", `/api/usuarios/${guiaId}/ficha`)).json().ficha.pixAlteradoEm).not.toBeNull();
  });

  it("anexo: só PDF/JPG/PNG pelos bytes, cifrado, baixa e exclui", async () => {
    const pdf = Buffer.from("%PDF-1.4\n% contrato ficticio\n").toString("base64");
    expect((await admin.req("POST", `/api/usuarios/${guiaId}/anexos`, { tipo: "CONTRATO", nome: "contrato.pdf", base64: Buffer.from("MZ executavel").toString("base64") })).statusCode).toBe(400);
    const { id } = (await admin.req("POST", `/api/usuarios/${guiaId}/anexos`, { tipo: "CONTRATO", nome: "contrato.pdf", base64: pdf })).json();
    const [a] = await db.select().from(usuariosAnexos).where(eq(usuariosAnexos.id, id));
    expect(a!.dadosCifrados).not.toContain(pdf);
    expect((await admin.req("GET", `/api/usuarios/${guiaId}/ficha`)).json().anexos[0]).toMatchObject({ id, tipo: "CONTRATO", mime: "application/pdf" });
    const baixado = await admin.req("GET", `/api/usuarios/${guiaId}/anexos/${id}`);
    expect(baixado.headers["content-type"]).toBe("application/pdf");
    expect(baixado.rawPayload.toString("base64")).toBe(pdf);
    expect((await admin.req("DELETE", `/api/usuarios/${guiaId}/anexos/${id}`)).statusCode).toBe(200);
  });
});
