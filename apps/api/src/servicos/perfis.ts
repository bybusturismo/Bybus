import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/cliente.js";
import { perfis, unidades } from "../db/schema.js";
import { ErroHttp } from "../seguranca/sessao.js";

export async function perfilPorCodigo(db: Db, codigo: string) {
  const [p] = await db.select().from(perfis).where(eq(perfis.codigo, codigo.toUpperCase()));
  if (!p) throw new ErroHttp(400, "PERFIL_INVALIDO", `Perfil "${codigo}" não existe.`);
  return p;
}

export async function validarUnidades(db: Db, ids: string[]) {
  if (ids.length === 0) return;
  const achadas = await db.select({ id: unidades.id }).from(unidades).where(inArray(unidades.id, ids));
  if (achadas.length !== new Set(ids).size) throw new ErroHttp(400, "UNIDADE_INVALIDA", "Praça/unidade inválida.");
}
