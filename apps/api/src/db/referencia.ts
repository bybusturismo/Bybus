import { and, eq } from "drizzle-orm";
import { PONTOS_TODA_ILHA } from "@bybus/core";
import type { Db } from "./cliente.js";
import { passeios, pontosEmbarque, unidades } from "./schema.js";

/** Dados de referência (passeio e pontos oficiais) — seguros para qualquer ambiente. */
export async function semearReferencia(db: Db) {
  let [passeio] = await db.select().from(passeios).where(eq(passeios.codigo, "TODA_ILHA"));
  if (!passeio) {
    // Praças e perfis padrão são criados pela migração 0004.
    const [fln] = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.codigo, "FLN"));
    if (!fln) throw new Error("Unidade FLN não encontrada — rode as migrações.");
    [passeio] = await db.insert(passeios).values({
      unidadeId: fln.id,
      linha: "CITY_TOUR",
      codigo: "TODA_ILHA",
      nome: "City Tour Toda Ilha",
      cidade: "Florianópolis",
      capacidadePadrao: 73,
      minimoConfirmacao: 12,
      minimoSupervisor: 10,
      padraoProduto: "toda ilha|whole island|floripa city tour",
    }).returning();
  }
  for (const p of PONTOS_TODA_ILHA) {
    const [existe] = await db.select({ id: pontosEmbarque.id }).from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, passeio!.id), eq(pontosEmbarque.ordem, p.ordem)));
    if (!existe) await db.insert(pontosEmbarque).values({ ...p, passeioId: passeio!.id });
  }
  return passeio!;
}

