import { and, eq } from "drizzle-orm";
import type { Db } from "../db/cliente.js";
import { escalas, passeios, pessoas, saidas } from "../db/schema.js";
import { ErroHttp } from "../seguranca/sessao.js";
import { motivosIndisponibilidade } from "./frota.js";

/** Guia/motorista precisa existir, estar ativo, ter o papel e ser da mesma praça (ou sem praça). */
export async function validarPessoaDaPraca(db: Db, id: string | null | undefined, papel: "GUIA" | "MOTORISTA", unidadeId: string) {
  if (!id) return null;
  const [p] = await db.select().from(pessoas).where(eq(pessoas.id, id));
  if (!p || !p.ativo || !p.papeis.includes(papel) || (p.unidadeId && p.unidadeId !== unidadeId)) {
    throw new ErroHttp(400, "PESSOA_INVALIDA", papel === "GUIA" ? "Guia inválido(a) para esta praça." : "Motorista inválido(a) para esta praça.");
  }
  return p;
}

/**
 * Equipe do dia: o que estiver na escala; sem escala, o motorista padrão do passeio.
 * Retorna também os nomes (a saída guarda o nome em texto por compatibilidade com as telas).
 */
export async function equipeDoDia(db: Db, passeioId: string, data: string) {
  const [e] = await db.select().from(escalas).where(and(eq(escalas.passeioId, passeioId), eq(escalas.data, data)));
  const [p] = await db.select({ motoristaPadraoId: passeios.motoristaPadraoId, veiculoPadrao: passeios.veiculoPadrao }).from(passeios).where(eq(passeios.id, passeioId));
  const guiaId = e?.guiaId ?? null;
  const motoristaId = e?.motoristaId ?? p?.motoristaPadraoId ?? null;
  const nome = async (id: string | null) => (id ? (await db.select({ nome: pessoas.nome }).from(pessoas).where(eq(pessoas.id, id)))[0]?.nome ?? null : null);
  return { guiaId, guia: await nome(guiaId), motoristaId, motorista: await nome(motoristaId), veiculo: p?.veiculoPadrao ?? null };
}

/**
 * Leva a equipe da escala para a saída do dia (se existir e ainda não tiver acontecido).
 * `sobrescrever` = troca/escala nova vale mesmo se a saída já tinha alguém; senão só preenche o que está vazio.
 */
export async function aplicarEscalaNaSaida(db: Db, passeioId: string, data: string, sobrescrever: boolean) {
  const [s] = await db.select().from(saidas).where(and(eq(saidas.passeioId, passeioId), eq(saidas.data, data)));
  if (!s || s.status === "REALIZADA" || s.status === "CANCELADA") return;
  const eq_ = await equipeDoDia(db, passeioId, data);
  const mudar: Partial<typeof saidas.$inferInsert> = {};
  if (eq_.guiaId && (sobrescrever || !s.guiaId)) Object.assign(mudar, { guiaId: eq_.guiaId, guia: eq_.guia });
  if (eq_.motoristaId && (sobrescrever || !s.motoristaId)) Object.assign(mudar, { motoristaId: eq_.motoristaId, motorista: eq_.motorista });
  if (eq_.veiculo && !s.veiculo && !(await motivosIndisponibilidade(db, eq_.veiculo, data))?.length) mudar.veiculo = eq_.veiculo;
  if (Object.keys(mudar).length) await db.update(saidas).set(mudar).where(eq(saidas.id, s.id));
}
