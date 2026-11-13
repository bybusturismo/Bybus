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

  async req(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown, cabecalhos: Record<string, string> = {}) {
    const r = await this.app.inject({
      method, url, payload: payload as never,
      headers: { cookie: this.cookie, ...(method !== "GET" ? { "x-bybus": "1" } : {}), ...cabecalhos },
    });
    // Guarda os cookies por nome (sessão e, por exemplo, o do Cofre), como um navegador.
    const setCookie = r.headers["set-cookie"];
    if (setCookie) {
      const atuais = new Map(this.cookie ? this.cookie.split("; ").map((c) => [c.split("=")[0]!, c] as const) : []);
      for (const linha of Array.isArray(setCookie) ? setCookie : [setCookie]) {
        const par = String(linha).split(";")[0]!;
        const nome = par.split("=")[0]!;
        if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(String(linha)) || par.endsWith("=")) atuais.delete(nome); else atuais.set(nome, par);
      }
      this.cookie = [...atuais.values()].join("; ");
    }
    return r;
  }

  async login(email: string, senha = SENHA_DEMO, codigo?: string) {
    return this.req("POST", "/api/auth/login", { email, senha, codigo });
  }
}
