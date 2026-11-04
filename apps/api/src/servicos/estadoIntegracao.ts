import { eq } from "drizzle-orm";
import type { Db } from "../db/cliente.js";
import { integracoesEstado } from "../db/schema.js";

/** Situação de uma integração automática ("paytour", "emails"): última execução, resultado e erro. */
export async function lerEstadoIntegracao(db: Db, chave: string) {
  const [e] = await db.select().from(integracoesEstado).where(eq(integracoesEstado.chave, chave));
  return e ?? null;
}

export async function gravarEstadoIntegracao(db: Db, chave: string, v: { cursor: string | null; ultimoResultado: unknown; ultimoErro: string | null }) {
  const linha = { ...v, ultimaExecucaoEm: new Date(), atualizadoEm: new Date() };
  await db.insert(integracoesEstado).values({ chave, ...linha }).onConflictDoUpdate({ target: integracoesEstado.chave, set: linha });
}
