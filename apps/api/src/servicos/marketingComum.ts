import { isNull, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/cliente.js";
import { marketingConfig } from "../db/schema.js";
import { filtroUnidade, podeUnidade } from "../seguranca/escopo.js";
import { ErroHttp, type UsuarioSessao } from "../seguranca/sessao.js";

/** Peças comuns das rotas do marketing 2 (avaliações, retorno, relatórios, bio, orçamentos, NPS). */

export const uuid = z.string().uuid();
export const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD").refine((d) => {
  const x = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0, 10) === d;
}, "Data inválida");
export const texto = (max: number) => z.string().trim().max(max);
export const textoOpc = (max: number) => texto(max).nullish().transform((v) => (v ? v : null));
export const urlHttps = z.string().trim().max(500).url().refine((u) => u.startsWith("https://"), "Use um endereço https://");
export const naoEncontrado = (o: string) => new ErroHttp(404, "NAO_ENCONTRADO", `${o} não encontrado(a).`);

const FUSO = "America/Sao_Paulo";
export const hojeSp = (agora: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(agora);
export function horaSp(agora: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(agora);
  return p;
}
export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
export const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const segundaDaSemana = (iso: string) => somarDias(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));

/** Período de consulta: padrão 90 dias para trás e 60 para a frente. */
export const periodoPadrao = (atras = 89, adiante = 60) => z.object({ de: dataIso.optional(), ate: dataIso.optional(), unidadeId: uuid.optional() }).transform((q) => ({
  de: q.de ?? somarDias(hojeSp(), -atras), ate: q.ate ?? somarDias(hojeSp(), adiante), unidadeId: q.unidadeId,
})).refine((p) => p.de <= p.ate, "A data inicial deve ser anterior à final.").refine((p) => (Date.parse(p.ate) - Date.parse(p.de)) / 86400_000 <= 800, "Período longo demais (máximo de 800 dias).");

/** Itens "de todas as praças" (unidade nula) são vistos por todos; os de uma praça só por quem tem acesso a ela. */
export function visivel(u: UsuarioSessao, coluna: AnyPgColumn): SQL | undefined {
  const escopo = filtroUnidade(u, coluna as never);
  return escopo ? or(isNull(coluna), escopo) : undefined;
}
export function exigirPraca(u: UsuarioSessao, unidadeId: string | undefined | null) {
  if (unidadeId && !podeUnidade(u, unidadeId)) throw naoEncontrado("Praça");
}

// ───────────── marketing_config (chave/valor) ─────────────

export async function lerChaves(db: Db): Promise<Map<string, string>> {
  const linhas = await db.select().from(marketingConfig);
  return new Map(linhas.map((l) => [l.chave, l.valor]));
}
export async function gravarChave(db: Db, chave: string, valor: string | null, usuarioId: string | null) {
  if (valor === null || valor === "") await db.delete(marketingConfig).where(eq(marketingConfig.chave, chave));
  else await db.insert(marketingConfig).values({ chave, valor, atualizadoPor: usuarioId }).onConflictDoUpdate({ target: marketingConfig.chave, set: { valor, atualizadoEm: new Date(), atualizadoPor: usuarioId } });
}
export const chaveLinkGoogle = (unidadeId: string) => `link_google_${unidadeId}`;
export const chaveLinkTripadvisor = (unidadeId: string) => `link_tripadvisor_${unidadeId}`;
