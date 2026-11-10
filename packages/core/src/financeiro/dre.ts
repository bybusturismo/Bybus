import { calcularBaixa } from "./dinheiro.js";
import {
  GRUPO_ADM, GRUPO_COMBUSTIVEL, GRUPO_COMISSOES, GRUPO_DEVOLUCOES, GRUPO_DIARIAS, GRUPO_EMPRESTIMOS, GRUPO_FINANCEIRO, GRUPO_FRETAMENTO,
  GRUPO_FROTA_FIXA, GRUPO_GRUPOS, GRUPO_IMPOSTOS_FATURAMENTO, GRUPO_INVESTIMENTOS, GRUPO_MANUTENCAO, GRUPO_PARCERIAS, GRUPO_PASSEIOS,
  GRUPO_PESSOAL, GRUPO_PESSOAL_FIXO, GRUPO_PUBLICIDADE, GRUPO_RECREATIVO, GRUPO_RETIRADAS, GRUPO_REVENDA, GRUPO_TRENZINHO, GRUPO_VIAGEM,
  type TipoCategoria,
} from "./plano.js";
import type { CategoriaInfo, LancamentoRelatorio } from "./relatorios.js";

/**
 * DRE gerencial (aba "DRE" do financeiro, aprovada pelo dono em 10/11/2026).
 * Seções em ordem, cada uma com os seus grupos; depois de algumas seções vem um subtotal.
 * Os valores têm sinal: receita positiva, despesa negativa. Assim o grupo de revenda mostra só a margem
 * (venda − repasse) e as devoluções recebidas abatem as pagas.
 */
export const SECOES_DRE = [
  { chave: "RECEITA_BRUTA", nome: "Receita bruta", subtotal: null },
  { chave: "DEDUCOES", nome: "(−) Deduções da receita", subtotal: "Receita líquida" },
  { chave: "CUSTOS_VENDA", nome: "(−) Custos de venda", subtotal: "Margem de contribuição" },
  { chave: "CUSTOS_OPERACAO", nome: "(−) Custos da operação", subtotal: "Lucro bruto" },
  { chave: "FROTA_FIXA", nome: "(−) Frota fixa", subtotal: null },
  { chave: "PESSOAL_FIXO", nome: "(−) Pessoal fixo", subtotal: null },
  { chave: "ADMINISTRATIVO", nome: "(−) Administrativo e comercial", subtotal: "Resultado operacional (EBITDA)" },
  { chave: "FINANCEIRO", nome: "(+/−) Resultado financeiro", subtotal: "Resultado líquido" },
] as const;
export type SecaoDre = (typeof SECOES_DRE)[number]["chave"] | "ABAIXO_DA_LINHA";

/** Grupos de cada seção, na ordem em que aparecem. */
export const GRUPOS_DA_SECAO: Readonly<Record<SecaoDre, readonly string[]>> = {
  RECEITA_BRUTA: [GRUPO_PASSEIOS, GRUPO_GRUPOS, GRUPO_FRETAMENTO, GRUPO_PUBLICIDADE, GRUPO_TRENZINHO, GRUPO_RECREATIVO, GRUPO_REVENDA],
  DEDUCOES: [GRUPO_IMPOSTOS_FATURAMENTO, GRUPO_DEVOLUCOES],
  CUSTOS_VENDA: [GRUPO_COMISSOES, GRUPO_PARCERIAS],
  CUSTOS_OPERACAO: [GRUPO_COMBUSTIVEL, GRUPO_DIARIAS, GRUPO_MANUTENCAO, GRUPO_VIAGEM],
  FROTA_FIXA: [GRUPO_FROTA_FIXA],
  PESSOAL_FIXO: [GRUPO_PESSOAL_FIXO],
  ADMINISTRATIVO: [GRUPO_ADM],
  FINANCEIRO: [GRUPO_FINANCEIRO],
  ABAIXO_DA_LINHA: [GRUPO_EMPRESTIMOS, GRUPO_INVESTIMENTOS, GRUPO_RETIRADAS, GRUPO_PESSOAL],
};

/** Grupos que a pessoa pode escolher ao criar uma categoria (todos os da DRE). */
export const GRUPOS_DRE: readonly string[] = Object.values(GRUPOS_DA_SECAO).flat();

/** Nomes antigos (planilha e categorias criadas antes de 10/11/2026) → seção. */
const SECAO_LEGADA: Record<string, SecaoDre> = {
  receita: "RECEITA_BRUTA", "outras receitas": "FINANCEIRO", taxas: "CUSTOS_VENDA", frota: "CUSTOS_OPERACAO", posto: "CUSTOS_OPERACAO",
  fixo: "ADMINISTRATIVO", tributos: "DEDUCOES", impostos: "DEDUCOES", rh: "PESSOAL_FIXO", administrativo: "ADMINISTRATIVO",
  "devoluções e estornos": "DEDUCOES", "revenda de terceiros": "RECEITA_BRUTA",
};

/** Seção da DRE de um grupo. Grupo desconhecido: receita vai para a receita bruta; despesa, para o administrativo. */
export function secaoDoGrupo(grupo: string, tipo: TipoCategoria): SecaoDre {
  for (const [secao, grupos] of Object.entries(GRUPOS_DA_SECAO)) if (grupos.includes(grupo)) return secao as SecaoDre;
  const legada = SECAO_LEGADA[grupo.trim().toLowerCase()];
  if (legada) return legada;
  if (/fora do resultado/i.test(grupo)) return "ABAIXO_DA_LINHA";
  return tipo === "RECEITA" ? "RECEITA_BRUTA" : "ADMINISTRATIVO";
}

export type RegimeDre = "COMPETENCIA" | "CAIXA";
export interface LancamentoDre extends LancamentoRelatorio {
  competencia: string;
}

export interface LinhaDreGerencial {
  /** SECAO (título com o total da seção), GRUPO, CATEGORIA ou SUBTOTAL. */
  nivel: "SECAO" | "GRUPO" | "CATEGORIA" | "SUBTOTAL";
  chave: string;
  nome: string;
  secao: SecaoDre;
  categoriaId: string | null;
  /** Um valor por mês (centavos, com sinal: receita +, despesa −). */
  valores: number[];
  total: number;
}

export interface DreGerencial {
  meses: string[];
  regime: RegimeDre;
  linhas: LinhaDreGerencial[];
  /** Linhas "abaixo da linha" (mexem no caixa, mas não são lucro nem prejuízo). */
  abaixoDaLinha: LinhaDreGerencial[];
  receitaBruta: number[];
  resultadoLiquido: number[];
}

const ENCARGOS = "Juros, multas e descontos das baixas";

/**
 * Monta a DRE mês a mês.
 * - COMPETENCIA: todos os lançamentos (abertos e realizados) pelo mês de competência, pelo valor do lançamento.
 * - CAIXA: só os realizados, pelo mês da baixa.
 * Nos realizados, juros + multa − desconto vão para o resultado financeiro.
 */
export function montarDreGerencial(lancamentos: LancamentoDre[], categorias: ReadonlyMap<string, CategoriaInfo>, meses: string[], regime: RegimeDre): DreGerencial {
  const idx = new Map(meses.map((m, i) => [m, i]));
  const n = meses.length;
  const zeros = () => Array<number>(n).fill(0);
  // categoriaId (ou ENCARGOS) → valores por mês
  const porCategoria = new Map<string, number[]>();
  const somar = (k: string, i: number, v: number) => {
    let a = porCategoria.get(k);
    if (!a) porCategoria.set(k, (a = zeros()));
    a[i] = (a[i] ?? 0) + v;
  };
  for (const l of lancamentos) {
    if (regime === "CAIXA" && (l.situacao !== "REALIZADO" || !l.pagoEm)) continue;
    const data = regime === "CAIXA" ? l.pagoEm! : l.competencia;
    const i = idx.get(data.slice(0, 7));
    if (i === undefined) continue;
    const sinal = l.tipo === "RECEBER" ? 1 : -1;
    somar(l.categoriaId, i, sinal * l.valorCentavos);
    if (l.situacao === "REALIZADO") {
      const pago = l.valorPagoCentavos ?? calcularBaixa({ valorCentavos: l.valorCentavos, jurosCentavos: l.jurosCentavos, multaCentavos: l.multaCentavos, descontoCentavos: l.descontoCentavos });
      const encargo = pago - l.valorCentavos;
      if (encargo !== 0) somar(ENCARGOS, i, sinal * encargo);
    }
  }

  // Monta a árvore seção → grupo → categoria.
  interface G { nome: string; categorias: Array<{ id: string | null; nome: string; ordem: number; valores: number[] }> }
  const arvore = new Map<SecaoDre, Map<string, G>>();
  for (const [k, valores] of porCategoria) {
    const info = k === ENCARGOS ? null : categorias.get(k);
    const grupo = k === ENCARGOS ? "Receitas e despesas financeiras" : info?.grupo ?? "Sem categoria";
    const secao = k === ENCARGOS ? "FINANCEIRO" : secaoDoGrupo(grupo, info?.tipo ?? "DESPESA");
    let gs = arvore.get(secao);
    if (!gs) arvore.set(secao, (gs = new Map()));
    let g = gs.get(grupo);
    if (!g) gs.set(grupo, (g = { nome: grupo, categorias: [] }));
    g.categorias.push({ id: k === ENCARGOS ? null : k, nome: k === ENCARGOS ? ENCARGOS : info?.nome ?? "Sem categoria", ordem: info?.ordem ?? 99_999, valores });
  }

  const soma = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? 0));
  const total = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const linhasDaSecao = (secao: SecaoDre): { linhas: LinhaDreGerencial[]; valores: number[] } => {
    const gs = arvore.get(secao);
    const ordemGrupo = (nome: string) => {
      const i = GRUPOS_DA_SECAO[secao].indexOf(nome);
      return i < 0 ? 999 : i;
    };
    const grupos = gs ? [...gs.values()].sort((a, b) => ordemGrupo(a.nome) - ordemGrupo(b.nome) || a.nome.localeCompare(b.nome)) : [];
    const linhas: LinhaDreGerencial[] = [];
    let valoresSecao = zeros();
    for (const g of grupos) {
      const cats = g.categorias.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
      const vg = cats.reduce((acc, c) => soma(acc, c.valores), zeros());
      valoresSecao = soma(valoresSecao, vg);
      linhas.push({ nivel: "GRUPO", chave: `${secao}|${g.nome}`, nome: g.nome, secao, categoriaId: null, valores: vg, total: total(vg) });
      for (const c of cats) linhas.push({ nivel: "CATEGORIA", chave: `${secao}|${g.nome}|${c.id ?? c.nome}`, nome: c.nome, secao, categoriaId: c.id, valores: c.valores, total: total(c.valores) });
    }
    return { linhas, valores: valoresSecao };
  };

  const linhas: LinhaDreGerencial[] = [];
  let acumulado = zeros();
  let receitaBruta = zeros();
  for (const s of SECOES_DRE) {
    const { linhas: ls, valores } = linhasDaSecao(s.chave);
    if (s.chave === "RECEITA_BRUTA") receitaBruta = valores;
    acumulado = soma(acumulado, valores);
    linhas.push({ nivel: "SECAO", chave: s.chave, nome: s.nome, secao: s.chave, categoriaId: null, valores, total: total(valores) }, ...ls);
    if (s.subtotal) linhas.push({ nivel: "SUBTOTAL", chave: `SUB_${s.chave}`, nome: s.subtotal, secao: s.chave, categoriaId: null, valores: [...acumulado], total: total(acumulado) });
  }
  const abaixo = linhasDaSecao("ABAIXO_DA_LINHA");
  return { meses, regime, linhas, abaixoDaLinha: abaixo.linhas, receitaBruta, resultadoLiquido: acumulado };
}

/** Percentual de um valor sobre a receita bruta, em pontos-base (1234 = 12,34%); null sem receita. */
export function percentualDaReceita(valor: number, receitaBruta: number): number | null {
  return receitaBruta > 0 ? Math.trunc((valor * 10000) / receitaBruta) : null;
}

/** Grupos cujos custos são do veículo (a placa é lida na importação e entra no custo por veículo da frota). Inclui os nomes antigos. */
export const GRUPOS_CUSTO_VEICULO: readonly string[] = [GRUPO_COMBUSTIVEL, GRUPO_MANUTENCAO, GRUPO_VIAGEM, GRUPO_FROTA_FIXA, "Frota", "Posto"];
