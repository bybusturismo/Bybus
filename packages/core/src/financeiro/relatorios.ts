import { calcularBaixa, somarDiasIso } from "./dinheiro.js";
import type { TipoCategoria } from "./plano.js";

export interface LancamentoRelatorio {
  tipo: "PAGAR" | "RECEBER";
  situacao: "ABERTO" | "REALIZADO";
  valorCentavos: number;
  valorPagoCentavos: number | null;
  jurosCentavos: number;
  multaCentavos: number;
  descontoCentavos: number;
  vencimento: string;
  pagoEm: string | null;
  categoriaId: string;
  unidadeId: string | null;
  linha: string | null;
}

/** Segunda-feira da semana da data (semana de segunda a domingo). */
export function inicioDaSemana(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
  return somarDiasIso(iso, -((dia + 6) % 7));
}

export interface SemanaFluxo {
  inicio: string;
  fim: string;
  atual: boolean;
  entradasRealizadasCentavos: number;
  saidasRealizadasCentavos: number;
  entradasPrevistasCentavos: number;
  saidasPrevistasCentavos: number;
  /** Saldo projetado ao fim da semana (só da semana atual em diante): saldo atual + previsto acumulado. */
  saldoProjetadoCentavos: number | null;
}

/**
 * Fluxo de caixa por semana: realizado (pela data da baixa) e previsto (em aberto, pelo vencimento).
 * Contas vencidas e ainda em aberto entram na semana atual, pois ainda vão sair/entrar do caixa.
 */
export function montarFluxoSemanal(p: { hoje: string; semanasAntes: number; semanasDepois: number; lancamentos: LancamentoRelatorio[]; saldoAtualCentavos: number }): SemanaFluxo[] {
  const atualIni = inicioDaSemana(p.hoje);
  const primeira = somarDiasIso(atualIni, -7 * p.semanasAntes);
  const total = p.semanasAntes + 1 + p.semanasDepois;
  const semanas: SemanaFluxo[] = Array.from({ length: total }, (_, i) => {
    const inicio = somarDiasIso(primeira, i * 7);
    return { inicio, fim: somarDiasIso(inicio, 6), atual: inicio === atualIni, entradasRealizadasCentavos: 0, saidasRealizadasCentavos: 0, entradasPrevistasCentavos: 0, saidasPrevistasCentavos: 0, saldoProjetadoCentavos: null };
  });
  const noIntervalo = (data: string) => semanas.find((s) => data >= s.inicio && data <= s.fim);
  for (const l of p.lancamentos) {
    if (l.situacao === "REALIZADO") {
      if (!l.pagoEm) continue;
      const s = noIntervalo(l.pagoEm);
      if (!s) continue;
      const v = l.valorPagoCentavos ?? l.valorCentavos;
      if (l.tipo === "RECEBER") s.entradasRealizadasCentavos += v; else s.saidasRealizadasCentavos += v;
    } else {
      const data = l.vencimento < p.hoje ? p.hoje : l.vencimento;
      const s = noIntervalo(data);
      if (!s) continue;
      if (l.tipo === "RECEBER") s.entradasPrevistasCentavos += l.valorCentavos; else s.saidasPrevistasCentavos += l.valorCentavos;
    }
  }
  let saldo = p.saldoAtualCentavos;
  for (const s of semanas) {
    if (s.inicio < atualIni) continue;
    saldo += s.entradasPrevistasCentavos - s.saidasPrevistasCentavos;
    s.saldoProjetadoCentavos = saldo;
  }
  return semanas;
}

export interface CategoriaInfo {
  nome: string;
  tipo: TipoCategoria;
  grupo: string;
  ordem: number;
}

export interface LinhaDre {
  categoriaId: string | null;
  nome: string;
  totalCentavos: number;
}
export interface GrupoDre {
  grupo: string;
  tipo: TipoCategoria;
  totalCentavos: number;
  categorias: LinhaDre[];
}
export interface LinhaPracaLinha {
  unidadeId: string | null;
  linha: string | null;
  receitaCentavos: number;
  despesaCentavos: number;
  resultadoCentavos: number;
}
export interface Dre {
  receitaCentavos: number;
  despesaCentavos: number;
  resultadoCentavos: number;
  /** Margem do resultado sobre a receita em pontos-base (1234 = 12,34%); null sem receita. */
  margemPontosBase: number | null;
  grupos: GrupoDre[];
  porPracaLinha: LinhaPracaLinha[];
}

const ENCARGOS = "Juros, multas e descontos";

/**
 * DRE gerencial por competência. Receitas e despesas pelo valor do lançamento; nos realizados,
 * juros + multa − desconto aparecem à parte ("Juros, multas e descontos"), como despesa (a pagar) ou receita (a receber).
 * A margem é calculada em pontos-base inteiros (centésimos de ponto percentual), truncada.
 */
export function montarDre(lancamentos: LancamentoRelatorio[], categorias: ReadonlyMap<string, CategoriaInfo>): Dre {
  const porCategoria = new Map<string, number>();
  let encargosReceita = 0;
  let encargosDespesa = 0;
  const matriz = new Map<string, LinhaPracaLinha>();
  const ponto = (l: LancamentoRelatorio) => {
    const k = `${l.unidadeId ?? ""}|${l.linha ?? ""}`;
    let x = matriz.get(k);
    if (!x) matriz.set(k, (x = { unidadeId: l.unidadeId, linha: l.linha, receitaCentavos: 0, despesaCentavos: 0, resultadoCentavos: 0 }));
    return x;
  };
  for (const l of lancamentos) {
    porCategoria.set(l.categoriaId, (porCategoria.get(l.categoriaId) ?? 0) + l.valorCentavos);
    const m = ponto(l);
    let encargo = 0;
    if (l.situacao === "REALIZADO") {
      const pago = l.valorPagoCentavos ?? calcularBaixa({ valorCentavos: l.valorCentavos, jurosCentavos: l.jurosCentavos, multaCentavos: l.multaCentavos, descontoCentavos: l.descontoCentavos });
      encargo = pago - l.valorCentavos;
    }
    if (l.tipo === "RECEBER") { m.receitaCentavos += l.valorCentavos + encargo; encargosReceita += encargo; }
    else { m.despesaCentavos += l.valorCentavos + encargo; encargosDespesa += encargo; }
  }
  const grupos = new Map<string, GrupoDre>();
  for (const [id, total] of porCategoria) {
    const info = categorias.get(id) ?? { nome: "Sem categoria", tipo: "DESPESA" as TipoCategoria, grupo: "Sem categoria", ordem: 9999 };
    const chave = `${info.tipo}|${info.grupo}`;
    let g = grupos.get(chave);
    if (!g) grupos.set(chave, (g = { grupo: info.grupo, tipo: info.tipo, totalCentavos: 0, categorias: [] }));
    g.totalCentavos += total;
    g.categorias.push({ categoriaId: id, nome: info.nome, totalCentavos: total });
  }
  const ordemCategoria = (c: LinhaDre) => categorias.get(c.categoriaId ?? "")?.ordem ?? 9999;
  const lista = [...grupos.values()].map((g) => ({ ...g, categorias: g.categorias.sort((a, b) => ordemCategoria(a) - ordemCategoria(b)) }));
  const ordemGrupo = (g: GrupoDre) => Math.min(...g.categorias.map(ordemCategoria));
  lista.sort((a, b) => (a.tipo === b.tipo ? ordemGrupo(a) - ordemGrupo(b) : a.tipo === "RECEITA" ? -1 : 1));
  if (encargosReceita !== 0) {
    const ultimaReceita = lista.map((g) => g.tipo).lastIndexOf("RECEITA");
    lista.splice(ultimaReceita + 1, 0, { grupo: ENCARGOS, tipo: "RECEITA", totalCentavos: encargosReceita, categorias: [{ categoriaId: null, nome: "Juros e multas recebidos, menos descontos concedidos", totalCentavos: encargosReceita }] });
  }
  if (encargosDespesa !== 0) lista.push({ grupo: ENCARGOS, tipo: "DESPESA", totalCentavos: encargosDespesa, categorias: [{ categoriaId: null, nome: "Juros e multas pagos, menos descontos obtidos", totalCentavos: encargosDespesa }] });
  const receita = lista.filter((g) => g.tipo === "RECEITA").reduce((s, g) => s + g.totalCentavos, 0);
  const despesa = lista.filter((g) => g.tipo === "DESPESA").reduce((s, g) => s + g.totalCentavos, 0);
  const porPracaLinha = [...matriz.values()].map((x) => ({ ...x, resultadoCentavos: x.receitaCentavos - x.despesaCentavos }))
    .sort((a, b) => (a.unidadeId ?? "").localeCompare(b.unidadeId ?? "") || (a.linha ?? "").localeCompare(b.linha ?? ""));
  return {
    receitaCentavos: receita,
    despesaCentavos: despesa,
    resultadoCentavos: receita - despesa,
    margemPontosBase: receita > 0 ? Math.trunc(((receita - despesa) * 10000) / receita) : null,
    grupos: lista,
    porPracaLinha,
  };
}
