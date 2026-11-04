import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Cliente, prepararBanco, subirApp } from "./ajuda.js";

let app: FastifyInstance;
let fechar: () => Promise<void>;
beforeAll(async () => {
  await prepararBanco();
  ({ app, fechar } = await subirApp());
});
afterAll(async () => fechar());

// PNG 1×1 transparente.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("foto de perfil", () => {
  it("grava, devolve, recusa arquivo disfarçado e apaga", async () => {
    const c = new Cliente(app);
    await c.login("atendente@bybus.test");
    expect((await c.req("GET", "/api/auth/eu")).json().usuario.fotoVersao).toBeNull();
    expect((await c.req("PUT", "/api/auth/foto", { imagem: `data:image/png;base64,${PNG}` })).statusCode).toBe(200);
    expect((await c.req("GET", "/api/auth/eu")).json().usuario.fotoVersao).toEqual(expect.any(Number));
    const f = await c.req("GET", "/api/auth/foto");
    expect(f.statusCode).toBe(200);
    expect(f.headers["content-type"]).toBe("image/png");
    // Texto com tipo de imagem declarado: recusado pela assinatura do arquivo.
    const falso = Buffer.from("<script>alert(1)</script>").toString("base64");
    expect((await c.req("PUT", "/api/auth/foto", { imagem: `data:image/png;base64,${falso}` })).statusCode).toBe(400);
    expect((await c.req("PUT", "/api/auth/foto", { imagem: `data:image/svg+xml;base64,${falso}` })).statusCode).toBe(400);
    expect((await c.req("DELETE", "/api/auth/foto")).statusCode).toBe(200);
    expect((await c.req("GET", "/api/auth/foto")).statusCode).toBe(404);
    expect((await new Cliente(app).req("GET", "/api/auth/foto")).statusCode).toBe(401);
  });
});
