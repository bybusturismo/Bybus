import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { emailsDeTeste } from "../src/servicos/email.js";
import { Cliente, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
const EMAIL = { EMAIL_USUARIO: "envio.ficticio@exemplo.test", EMAIL_SENHA: "senha-de-app-ficticia", URL_PUBLICA: "https://gestao.exemplo.test" };

beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp(EMAIL));
});
afterAll(async () => fechar());

const pedir = (email: string) => new Cliente(app).req("POST", "/api/auth/esqueci", { email });
const codigoDoEmail = () => /redefinir-senha\?c=([\w-]+)/.exec(emailsDeTeste.at(-1)!.texto)![1]!;

describe("esqueci minha senha (link por e-mail)", () => {
  it("responde igual para e-mail cadastrado ou não, e só manda e-mail para quem existe", async () => {
    const antes = emailsDeTeste.length;
    const a = await pedir("ninguem@exemplo.test");
    const b = await pedir("guia@bybus.test");
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
    expect(emailsDeTeste.length).toBe(antes + 1);
    expect(emailsDeTeste.at(-1)).toMatchObject({ para: "guia@bybus.test" });
    expect(emailsDeTeste.at(-1)!.texto).toContain("https://gestao.exemplo.test/redefinir-senha?c=");
  });

  it("o link troca a senha uma vez só, com a política de senha, e o pedido novo invalida o anterior", async () => {
    await pedir("guia@bybus.test");
    const velho = codigoDoEmail();
    await pedir("guia@bybus.test");
    const novo = codigoDoEmail();
    const c = new Cliente(app);
    expect((await c.req("POST", "/api/auth/redefinir", { codigo: velho, senha: "NovaSenha-2026" })).json().codigo).toBe("LINK_INVALIDO");
    expect((await c.req("POST", "/api/auth/redefinir", { codigo: novo, senha: "curta" })).json().codigo).toBe("SENHA_FRACA");
    expect((await c.req("POST", "/api/auth/redefinir", { codigo: novo, senha: "NovaSenha-2026" })).statusCode).toBe(200);
    expect((await c.req("POST", "/api/auth/redefinir", { codigo: novo, senha: "OutraSenha-2026" })).json().codigo).toBe("LINK_INVALIDO");
    expect((await new Cliente(app).login("guia@bybus.test", "NovaSenha-2026")).statusCode).toBe(200);
  });

  it("sem e-mail configurado avisa para falar com o administrador", async () => {
    const s = await subirApp();
    try {
      const r = await new Cliente(s.app).req("POST", "/api/auth/esqueci", { email: "guia@bybus.test" });
      expect(r.statusCode).toBe(503);
    } finally { await s.fechar(); }
  });
});
