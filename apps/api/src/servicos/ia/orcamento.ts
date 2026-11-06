import { custoMicroUsd, limiteAtingido, mesSaoPaulo } from "@bybus/core";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Config } from "../../config.js";
import type { Db } from "../../db/cliente.js";
import { iaUso } from "../../db/schema.js";
import { ErroIA, type BlocoIA, type RespostaIA } from "./cliente.js";
import { gastoDoMesMicro } from "./retratos.js";

/** Antes de cada chamada: se o limite mensal já foi atingido, recusa (a IA não gasta além do combinado). */
export async function garantirOrcamento(db: Db, config: Config, agora = new Date()) {
  const gasto = await gastoDoMesMicro(db, mesSaoPaulo(agora));
  if (limiteAtingido(gasto, config.IA_LIMITE_MES_USD)) {
    throw new ErroIA("IA_LIMITE", `Limite mensal de IA atingido (US$ ${config.IA_LIMITE_MES_USD.toFixed(2)}). Ajuste IA_LIMITE_MES_USD ou aguarde o próximo mês.`);
  }
}

export interface DadosUso {
  tipo: "AVALIACAO" | "DEBATE" | "SINTESE" | "ASSISTENTE" | "LEGENDA";
  usuarioId?: string | null;
  avaliacaoId?: string | null;
  gestor?: string | null;
  ferramentas?: string[];
}

/** Grava o uso de uma chamada (tokens e custo; nunca o texto). Devolve o custo em micro-dólares. */
export async function registrarUso(db: Db, modelo: string, resposta: RespostaIA, d: DadosUso, agora = new Date()): Promise<number> {
  const u = resposta.usage;
  const custo = custoMicroUsd(resposta.modelo || modelo, {
    entrada: u.input_tokens,
    saida: u.output_tokens,
    cacheLeitura: u.cache_read_input_tokens ?? 0,
    cacheEscrita: u.cache_creation_input_tokens ?? 0,
  });
  await db.insert(iaUso).values({
    mesRef: mesSaoPaulo(agora),
    tipo: d.tipo,
    modelo: resposta.modelo || modelo,
    tokensEntrada: u.input_tokens,
    tokensSaida: u.output_tokens,
    tokensCacheLeitura: u.cache_read_input_tokens ?? 0,
    tokensCacheEscrita: u.cache_creation_input_tokens ?? 0,
    custoMicroUsd: custo,
    usuarioId: d.usuarioId ?? null,
    avaliacaoId: d.avaliacaoId ?? null,
    gestor: d.gestor ?? null,
    ferramentas: d.ferramentas ?? [],
  });
  return custo;
}

export async function resumoDeUso(db: Db, config: Config, agora = new Date()) {
  const mes = mesSaoPaulo(agora);
  const gasto = await gastoDoMesMicro(db, mes);
  const porTipo = await db
    .select({ tipo: iaUso.tipo, chamadas: sql<number>`count(*)::int`, custo: sql<number>`coalesce(sum(${iaUso.custoMicroUsd}), 0)::bigint` })
    .from(iaUso)
    .where(eq(iaUso.mesRef, mes))
    .groupBy(iaUso.tipo);
  const recentes = await db
    .select({ criadoEm: iaUso.criadoEm, tipo: iaUso.tipo, modelo: iaUso.modelo, tokensEntrada: iaUso.tokensEntrada, tokensSaida: iaUso.tokensSaida, custoMicroUsd: iaUso.custoMicroUsd, gestor: iaUso.gestor, ferramentas: iaUso.ferramentas })
    .from(iaUso)
    .where(and(gte(iaUso.criadoEm, new Date(agora.getTime() - 3 * 86_400_000))))
    .orderBy(desc(iaUso.criadoEm))
    .limit(50);
  return {
    mes,
    gastoUsd: gasto / 1_000_000,
    limiteUsd: config.IA_LIMITE_MES_USD,
    percentual: config.IA_LIMITE_MES_USD > 0 ? Math.round((gasto / (config.IA_LIMITE_MES_USD * 1_000_000)) * 1000) / 10 : null,
    porTipo: porTipo.map((t) => ({ tipo: t.tipo, chamadas: t.chamadas, custoUsd: Number(t.custo) / 1_000_000 })),
    recentes: recentes.map((r) => ({ ...r, custoUsd: r.custoMicroUsd / 1_000_000 })),
  };
}

export const textoDe = (blocos: BlocoIA[]) =>
  blocos
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
