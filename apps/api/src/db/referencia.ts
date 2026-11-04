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
  await semearPasseiosEncerrados(db);
  return passeio!;
}

/**
 * Passeios que já acabaram, cadastrados inativos só para o histórico de vendas importado da Paytour.
 * [A CONFIRMAR] capacidade e mínimos (usados os do City Tour); pontos do Oktobertour.
 */
const ENCERRADOS = [
  { codigo: "BRUXOLICO", nome: "City Tour – Passeio Bruxólico", padraoProduto: "brux[oó]lico", pontos: [{ ordem: 10, horario: "18:30", nome: "Villa Romana Shopping", endereco: "Ponto de táxi — Rua Santa Mônica", ehTransfer: false }] },
  { codigo: "OKTOBERTOUR_MANHA", nome: "Oktobertour – Saída de manhã", padraoProduto: "oktobertour.*manh", pontos: [] },
  { codigo: "OKTOBERTOUR_TARDE", nome: "Oktobertour – Saída à tarde", padraoProduto: "oktobertour.*tarde", pontos: [] },
] as const;

async function semearPasseiosEncerrados(db: Db) {
  const [fln] = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.codigo, "FLN"));
  if (!fln) return;
  for (const e of ENCERRADOS) {
    let [p] = await db.select().from(passeios).where(eq(passeios.codigo, e.codigo));
    if (!p) {
      [p] = await db.insert(passeios).values({
        unidadeId: fln.id, linha: "CITY_TOUR", codigo: e.codigo, nome: e.nome, cidade: "Florianópolis",
        capacidadePadrao: 73, minimoConfirmacao: 12, minimoSupervisor: 10, padraoProduto: e.padraoProduto, ativo: false,
      }).returning();
    }
    for (const ponto of e.pontos) {
      const [existe] = await db.select({ id: pontosEmbarque.id }).from(pontosEmbarque).where(and(eq(pontosEmbarque.passeioId, p!.id), eq(pontosEmbarque.ordem, ponto.ordem)));
      if (!existe) await db.insert(pontosEmbarque).values({ ...ponto, passeioId: p!.id });
    }
  }
}

