import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ganchoLogErro, mascarar, registrarErro } from "../src/servicos/diagnostico.js";
import { CHAVE, prepararBanco, subirApp } from "./ajuda.js";

const TOKEN = "diagnostico-ficticio-0123456789abcdefghijklmnop";
let com: { app: FastifyInstance; fechar: () => Promise<void> };
let sem: { app: FastifyInstance; fechar: () => Promise<void> };

beforeAll(async () => {
  await prepararBanco();
  com = await subirApp({ DIAGNOSTICO_TOKEN: TOKEN, VERSAO: "abc1234" });
  sem = await subirApp();
});
afterAll(async () => { await com.fechar(); await sem.fechar(); });

const pedir = (a: FastifyInstance, auth?: string) => a.inject({ method: "GET", url: "/api/diagnostico", headers: auth ? { authorization: auth } : {} });

describe("diagnóstico só de leitura (19/11/2026)", () => {
  it("sem a senha configurada a rota não existe; senha ausente ou errada responde 404", async () => {
    expect((await pedir(sem.app, `Bearer ${TOKEN}`)).statusCode).toBe(404);
    expect((await pedir(com.app)).statusCode).toBe(404);
    expect((await pedir(com.app, "Bearer senha-errada-0123456789abcdefghijklmnop")).statusCode).toBe(404);
  });

  it("com a senha: versão, banco e migrações em dia, integrações só como ligada/desligada, sem segredos", async () => {
    await com.app.inject({ method: "GET", url: "/api/saude" });
    const r = await pedir(com.app, `Bearer ${TOKEN}`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    const d = r.json();
    expect(d).toMatchObject({ versao: "abc1234", ambiente: "testes", banco: { ok: true } });
    expect(d.banco.migracoesAplicadas).toBe(d.banco.migracoesEsperadas);
    expect(d.integracoes).toMatchObject({ whatsapp: "simulado", ia: { ligada: false }, tripadvisor: false, googleAvaliacoes: { configurado: false, conectado: false } });
    expect(d.requisicoesPorHora.at(-1).total).toBeGreaterThan(0);
    expect(r.body).not.toContain(TOKEN);
    expect(r.body).not.toContain(CHAVE);
  });

  it("erros entram mascarados (sem e-mail, documento, valores do banco ou chaves) e as rotinas também são registradas", async () => {
    expect(mascarar('duplicate key value violates unique constraint "usuarios_email_uq" Key (lower(email))=(fulana@exemplo.com) already exists'))
      .toBe('duplicate key value violates unique constraint "[texto]" Key (lower(email))=([valor]) already exists');
    expect(mascarar("CPF 123.456.789-09 de joao@x.com com Bearer abc.def e sk-ant-api03-xyz")).toBe("CPF [número] de [e-mail] com Bearer [chave] e [chave]");
    registrarErro({ origem: "requisicao", rota: "GET /api/x", status: 500, erro: Object.assign(new Error("falhou para maria@exemplo.com"), { code: "23505" }) });
    let chamou = false;
    ganchoLogErro.logMethod.call({ bindings: () => ({}) }, [{ erro: "conexão recusada" }, "Falha nas rotinas do marketing"], () => { chamou = true; }, 50);
    ganchoLogErro.logMethod.call({ bindings: () => ({ reqId: "req-1" }) }, [new Error("já contado pela rota")], () => {}, 50);
    expect(chamou).toBe(true);
    const d = (await pedir(com.app, `Bearer ${TOKEN}`)).json();
    expect(d.erros[0]).toMatchObject({ origem: "rotina", mensagem: "Falha nas rotinas do marketing: conexão recusada" });
    expect(d.erros[1]).toMatchObject({ origem: "requisicao", rota: "GET /api/x", status: 500, codigo: "23505", mensagem: "falhou para [e-mail]" });
    expect(JSON.stringify(d.erros)).not.toContain("já contado pela rota");
  });
});
