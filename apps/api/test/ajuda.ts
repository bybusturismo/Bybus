import pg from "pg";
import type { FastifyInstance } from "fastify";
import { criarApp } from "../src/app.js";
import { lerConfig } from "../src/config.js";
import { migrar } from "../src/db/migrar.js";
import { criarDb } from "../src/db/cliente.js";
import { semearFicticios, SENHA_DEMO } from "../src/db/ficticios.js";

export const DATABASE_URL = process.env.DATABASE_URL_TESTE ?? "postgres://bybus:bybus_dev_local@localhost:5432/bybus_test";
export const CHAVE = Buffer.alloc(32, 7).toString("base64");

/** Recria o banco de teste do zero com dados fictícios. */
export async function prepararBanco() {
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await c.end();
  await migrar(DATABASE_URL);
  const { db, pool } = criarDb(DATABASE_URL);
  await semearFicticios(db, CHAVE);
  await pool.end();
}

export async function subirApp(extra: Record<string, string> = {}) {
  const config = lerConfig({ AMBIENTE: "testes", DATABASE_URL, CHAVE_CRIPTOGRAFIA: CHAVE, EXIGIR_MFA_ADMIN: "false", LIMITE_LOGIN_POR_MINUTO: "1000", ...extra });
  return criarApp(config);
}

export class Cliente {
  cookie = "";
  constructor(private app: FastifyInstance) {}

  async req(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
    const r = await this.app.inject({
      method, url, payload: payload as never,
      headers: { cookie: this.cookie, ...(method !== "GET" ? { "x-bybus": "1" } : {}) },
    });
    const setCookie = r.headers["set-cookie"];
    if (setCookie) this.cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0]!;
    return r;
  }

  async login(email: string, senha = SENHA_DEMO, codigo?: string) {
    return this.req("POST", "/api/auth/login", { email, senha, codigo });
  }
}
