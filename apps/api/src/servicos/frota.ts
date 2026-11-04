import { and, asc, eq, inArray } from "drizzle-orm";
import {
  alertaConsumo, consumoPorAbastecimento, ITENS_CHECKLIST_PADRAO, motivosBloqueio, situacaoPlano,
  type FonteKm, type SituacaoPlano,
} from "@bybus/core";
import type { Db } from "../db/cliente.js";
import { checklistItens, veiculos, veiculosAbastecimentos, veiculosDocumentos, veiculosKm, veiculosOrdens, veiculosPlanos } from "../db/schema.js";
import { ErroHttp } from "../seguranca/sessao.js";

export const hojeSp = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

type Veiculo = typeof veiculos.$inferSelect;
type Plano = typeof veiculosPlanos.$inferSelect;

export interface PlanoCalculado extends Plano {
  situacao: SituacaoPlano;
  proximoKm: number | null;
  proximaData: string | null;
  kmRestante: number | null;
  diasRestantes: number | null;
}

export function calcularPlano(p: Plano, kmAtual: number, hoje: string): PlanoCalculado {
  const r = situacaoPlano({ intervaloKm: p.intervaloKm, intervaloDias: p.intervaloDias, ultimoKm: p.ultimoKm, ultimaData: p.ultimaData, kmAtual, hoje });
  return { ...p, ...r };
}

/** Documentos, planos e ordens de cada veículo, já com os motivos de bloqueio (documento vencido, manutenção crítica…). */
export async function situacaoOperacional(db: Db, lista: Veiculo[], hoje: string) {
  const ids = lista.map((v) => v.id);
  const [docs, planos, ordens] = ids.length ? await Promise.all([
    db.select().from(veiculosDocumentos).where(inArray(veiculosDocumentos.veiculoId, ids)),
    db.select().from(veiculosPlanos).where(and(inArray(veiculosPlanos.veiculoId, ids), eq(veiculosPlanos.ativo, true))),
    db.select().from(veiculosOrdens).where(and(inArray(veiculosOrdens.veiculoId, ids), inArray(veiculosOrdens.status, ["ABERTA", "EM_ANDAMENTO"]))),
  ]) : [[], [], []];
  return new Map(lista.map((v) => {
    const meusDocs = docs.filter((d) => d.veiculoId === v.id);
    const meusPlanos = planos.filter((p) => p.veiculoId === v.id).map((p) => calcularPlano(p, v.kmAtual, hoje));
    const minhasOrdens = ordens.filter((o) => o.veiculoId === v.id);
    const motivos = motivosBloqueio({
      situacao: v.situacao as never, documentos: meusDocs, planos: meusPlanos,
      ordensImobilizando: minhasOrdens.filter((o) => o.imobiliza).length, hoje,
    });
    return [v.id, { documentos: meusDocs, planos: meusPlanos, ordensAbertas: minhasOrdens, motivos, disponivel: motivos.length === 0 }];
  }));
}

/**
 * Registra uma leitura de km e sobe o km atual do veículo (o km só sobe).
 * `estrito`: recusa km menor que o atual (digitação do usuário). Sem `estrito`, leitura antiga é ignorada
 * (ex.: abastecimento lançado fora de ordem). É o ponto de entrada da futura integração com o rastreador Khronos
 * (fonte "KHRONOS"): basta chamar esta função com a leitura recebida.
 */
export async function registrarLeituraKm(
  db: Db,
  p: { veiculoId: string; km: number; data: string; fonte: FonteKm; usuarioId?: string | null; estrito?: boolean },
): Promise<{ registrada: boolean; kmAtual: number }> {
  const [v] = await db.select({ kmAtual: veiculos.kmAtual }).from(veiculos).where(eq(veiculos.id, p.veiculoId));
  if (!v) throw new ErroHttp(404, "NAO_ENCONTRADO", "Veículo não encontrado(a).");
  if (p.km < v.kmAtual) {
    if (p.estrito) throw new ErroHttp(409, "KM_MENOR", `O km informado (${p.km}) é menor que o km atual do veículo (${v.kmAtual}).`);
    return { registrada: false, kmAtual: v.kmAtual };
  }
  await db.insert(veiculosKm).values({ veiculoId: p.veiculoId, data: p.data, km: p.km, fonte: p.fonte, criadoPor: p.usuarioId ?? null });
  if (p.km > v.kmAtual) await db.update(veiculos).set({ kmAtual: p.km, atualizadoEm: new Date() }).where(eq(veiculos.id, p.veiculoId));
  return { registrada: true, kmAtual: Math.max(p.km, v.kmAtual) };
}

/** Veículo volta a ATIVO quando não resta ordem aberta que o imobilize (só se estava em manutenção). */
export async function reavaliarSituacao(db: Db, veiculoId: string) {
  const abertas = await db.select({ id: veiculosOrdens.id }).from(veiculosOrdens)
    .where(and(eq(veiculosOrdens.veiculoId, veiculoId), eq(veiculosOrdens.imobiliza, true), inArray(veiculosOrdens.status, ["ABERTA", "EM_ANDAMENTO"])));
  if (abertas.length) {
    await db.update(veiculos).set({ situacao: "MANUTENCAO", atualizadoEm: new Date() }).where(and(eq(veiculos.id, veiculoId), eq(veiculos.situacao, "ATIVO")));
  } else {
    await db.update(veiculos).set({ situacao: "ATIVO", atualizadoEm: new Date() }).where(and(eq(veiculos.id, veiculoId), eq(veiculos.situacao, "MANUTENCAO")));
  }
}

type Abastecimento = typeof veiculosAbastecimentos.$inferSelect;
export type AbastecimentoCalculado = Abastecimento & { kml: number | null; alerta: "ALTO" | "BAIXO" | null };

/** Consumo e alerta de cada abastecimento (por veículo, em ordem de km). */
export function calcularAbastecimentos(lista: Abastecimento[]): AbastecimentoCalculado[] {
  const porVeiculo = new Map<string, Abastecimento[]>();
  for (const a of lista) porVeiculo.set(a.veiculoId, [...(porVeiculo.get(a.veiculoId) ?? []), a]);
  const saida: AbastecimentoCalculado[] = [];
  for (const itens of porVeiculo.values()) {
    const kml = consumoPorAbastecimento(itens);
    const anteriores: Array<number | null> = [];
    for (const a of [...itens].sort((x, y) => x.km - y.km)) {
      const v = kml.get(a.id) ?? null;
      saida.push({ ...a, kml: v, alerta: alertaConsumo(v, anteriores) });
      anteriores.push(v);
    }
  }
  return saida;
}

/** Cria os itens padrão do checklist na primeira vez (a equipe edita depois). */
export async function garantirItensChecklist(db: Db) {
  const [existe] = await db.select({ id: checklistItens.id }).from(checklistItens).limit(1);
  if (existe) return;
  await db.insert(checklistItens).values(ITENS_CHECKLIST_PADRAO.map((i, n) => ({ ...i, ordem: (n + 1) * 10 })));
}

export const itensAtivos = (db: Db) => db.select().from(checklistItens).where(eq(checklistItens.ativo, true)).orderBy(asc(checklistItens.ordem), asc(checklistItens.descricao));

