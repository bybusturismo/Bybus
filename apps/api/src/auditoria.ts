import type { FastifyRequest } from "fastify";
import type { Db } from "./db/cliente.js";
import { auditoria } from "./db/schema.js";

export async function auditar(
  db: Db,
  req: FastifyRequest | null,
  acao: string,
  entidade?: { tipo: string; id?: string | null },
  dados?: Record<string, unknown>,
  usuarioId?: string | null,
) {
  await db.insert(auditoria).values({
    usuarioId: usuarioId ?? req?.usuario?.id ?? null,
    acao,
    entidade: entidade?.tipo ?? null,
    entidadeId: entidade?.id ?? null,
    dados: dados ?? null,
    ip: req?.ip ?? null,
  });
}
