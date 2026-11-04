import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/cliente.js";
import { reservas, saidas } from "../db/schema.js";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Gera (ou regenera) o link de embarque de uma reserva: o token vai só no link; o banco guarda o hash.
 * Vale até o fim do dia do passeio (03:00 UTC do dia seguinte = 00:00 em Brasília).
 */
export async function gerarLinkEmbarque(db: Db, reservaId: string): Promise<{ token: string; caminho: string; expiraEm: Date }> {
  const [r] = await db.select({ data: saidas.data }).from(reservas).innerJoin(saidas, eq(saidas.id, reservas.saidaId)).where(eq(reservas.id, reservaId));
  if (!r) throw new Error("Reserva não encontrada.");
  const token = randomBytes(24).toString("base64url");
  const expiraEm = new Date(new Date(`${r.data}T03:00:00Z`).getTime() + 86_400_000);
  await db.update(reservas).set({ tokenEmbarqueHash: hashToken(token), tokenEmbarqueExpiraEm: expiraEm }).where(eq(reservas.id, reservaId));
  return { token, caminho: `/embarque/${token}`, expiraEm };
}
