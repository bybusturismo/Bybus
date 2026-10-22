import { eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/cliente.js";
import { passageiros, passeios, pontosEmbarque, reservas, saidas, unidades } from "../db/schema.js";
import { ErroHttp, type UsuarioSessao } from "./sessao.js";

/**
 * Escopo por praça/unidade (ADR 0005): todo dado operacional pertence a uma unidade (via passeio).
 * Sempre que uma rota recebe um id, conferimos se ele está numa unidade do usuário (evita IDOR).
 */
export function filtroUnidade(u: UsuarioSessao, coluna: typeof passeios.unidadeId = passeios.unidadeId): SQL | undefined {
  if (u.todasUnidades) return undefined;
  if (u.unidadeIds.length === 0) return sql`false`;
  return inArray(coluna, u.unidadeIds);
}

export function podeUnidade(u: UsuarioSessao, unidadeId: string | null | undefined): boolean {
  return u.todasUnidades || (!!unidadeId && u.unidadeIds.includes(unidadeId));
}

const naoEncontrado = (o: string) => new ErroHttp(404, "NAO_ENCONTRADO", `${o} não encontrado(a).`);

export async function unidadeDaSaida(db: Db, saidaId: string) {
  const [r] = await db.select({ unidadeId: passeios.unidadeId }).from(saidas).innerJoin(passeios, eq(passeios.id, saidas.passeioId)).where(eq(saidas.id, saidaId));
  return r?.unidadeId ?? null;
}

/** Garante que a saída existe e é de uma unidade do usuário (404 em ambos os casos, para não revelar existência). */
export async function garantirSaida(db: Db, u: UsuarioSessao, saidaId: string) {
  const unidadeId = await unidadeDaSaida(db, saidaId);
  if (!unidadeId || !podeUnidade(u, unidadeId)) throw naoEncontrado("Saída");
  return unidadeId;
}

export async function garantirReserva(db: Db, u: UsuarioSessao, reservaId: string) {
  const [r] = await db.select({ saidaId: reservas.saidaId }).from(reservas).where(eq(reservas.id, reservaId));
  if (!r) throw naoEncontrado("Reserva");
  await garantirSaida(db, u, r.saidaId).catch(() => { throw naoEncontrado("Reserva"); });
  return r.saidaId;
}

export async function garantirPassageiro(db: Db, u: UsuarioSessao, passageiroId: string) {
  const [p] = await db.select({ reservaId: passageiros.reservaId }).from(passageiros).where(eq(passageiros.id, passageiroId));
  if (!p) throw naoEncontrado("Passageiro");
  await garantirReserva(db, u, p.reservaId).catch(() => { throw naoEncontrado("Passageiro"); });
}

export async function garantirPasseio(db: Db, u: UsuarioSessao, passeioId: string) {
  const [p] = await db.select({ unidadeId: passeios.unidadeId }).from(passeios).where(eq(passeios.id, passeioId));
  if (!p || !podeUnidade(u, p.unidadeId)) throw naoEncontrado("Passeio");
  return p.unidadeId;
}

export async function garantirPonto(db: Db, u: UsuarioSessao, pontoId: string) {
  const [p] = await db.select({ passeioId: pontosEmbarque.passeioId }).from(pontosEmbarque).where(eq(pontosEmbarque.id, pontoId));
  if (!p) throw naoEncontrado("Ponto");
  await garantirPasseio(db, u, p.passeioId).catch(() => { throw naoEncontrado("Ponto"); });
}

/** Praça desativada não recebe novos cadastros (dados antigos continuam consultáveis). */
export async function garantirUnidadeAtiva(db: Db, unidadeId: string) {
  const [x] = await db.select({ ativa: unidades.ativa }).from(unidades).where(eq(unidades.id, unidadeId));
  if (!x?.ativa) throw new ErroHttp(400, "PRACA_INATIVA", "Esta praça está desativada.");
}
