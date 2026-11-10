import { describe, expect, it } from "vitest";
import {
  GRUPOS_DA_SECAO, GRUPOS_DRE, PLANO_CATEGORIAS, montarDreGerencial, percentualDaReceita, secaoDoGrupo, type CategoriaInfo, type LancamentoDre,
} from "../src/index.js";

const cats = new Map<string, CategoriaInfo>(PLANO_CATEGORIAS.map((c, i) => [c.codigo, { nome: c.nome, tipo: c.tipo, grupo: c.grupo, ordem: i }]));
const base = { situacao: "ABERTO" as const, valorPagoCentavos: null, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0, vencimento: "2026-10-10", pagoEm: null, unidadeId: null, linha: null, competencia: "2026-10-05" };
const rec = (categoriaId: string, valorCentavos: number, extra: Partial<LancamentoDre> = {}): LancamentoDre => ({ ...base, tipo: "RECEBER", categoriaId, valorCentavos, ...extra });
const pag = (categoriaId: string, valorCentavos: number, extra: Partial<LancamentoDre> = {}): LancamentoDre => ({ ...base, tipo: "PAGAR", categoriaId, valorCentavos, ...extra });
const linha = (d: ReturnType<typeof montarDreGerencial>, chave: string) => d.linhas.find((l) => l.chave === chave);

describe("DRE gerencial", () => {
  it("todo grupo do plano de categorias pertence a uma seção da DRE", () => {
    for (const c of PLANO_CATEGORIAS) expect(GRUPOS_DRE).toContain(c.grupo);
  });

  it("seção de grupos antigos e desconhecidos", () => {
    expect(secaoDoGrupo("Frota", "DESPESA")).toBe("CUSTOS_OPERACAO");
    expect(secaoDoGrupo("RH", "DESPESA")).toBe("PESSOAL_FIXO");
    expect(secaoDoGrupo("Inventado", "RECEITA")).toBe("RECEITA_BRUTA");
    expect(secaoDoGrupo("Inventado", "DESPESA")).toBe("ADMINISTRATIVO");
    expect(secaoDoGrupo(GRUPOS_DA_SECAO.ABAIXO_DA_LINHA[0]!, "DESPESA")).toBe("ABAIXO_DA_LINHA");
  });

  it("calcula os subtotais em cascata, a margem da revenda e deixa empréstimos e pessoal abaixo da linha", () => {
    const d = montarDreGerencial([
      rec("REC_SITE_PAYTOUR", 1_000_000),
      rec("REC_REVENDA", 200_000), pag("DESP_REVENDA_REPASSE", 150_000),
      pag("DESP_IMPOSTOS", 60_000),
      pag("DESP_COMISSOES", 90_000),
      pag("DESP_COMBUSTIVEL", 200_000),
      pag("DESP_IPVA", 50_000),
      pag("DESP_FOLHA_CLT", 300_000),
      pag("DESP_ALUGUEL", 100_000),
      pag("DESP_JUROS", 10_000),
      rec("REC_EMPRESTIMO", 500_000), pag("DESP_PESSOAL", 20_000), pag("DESP_CONSORCIO", 40_000),
      pag("DESP_COMBUSTIVEL", 999_999, { competencia: "2026-12-01" }), // fora dos meses pedidos
    ], cats, ["2026-10", "2026-11"], "COMPETENCIA");

    expect(d.receitaBruta).toEqual([1_050_000, 0]);
    expect(linha(d, "RECEITA_BRUTA|Revenda de terceiros (margem)")?.total).toBe(50_000);
    expect(linha(d, "SUB_DEDUCOES")?.valores).toEqual([990_000, 0]);
    expect(linha(d, "SUB_CUSTOS_VENDA")?.total).toBe(900_000);
    expect(linha(d, "SUB_CUSTOS_OPERACAO")?.total).toBe(700_000);
    expect(linha(d, "SUB_ADMINISTRATIVO")?.total).toBe(250_000);
    expect(linha(d, "SUB_FINANCEIRO")?.total).toBe(240_000);
    expect(d.resultadoLiquido).toEqual([240_000, 0]);
    expect(d.abaixoDaLinha.filter((l) => l.nivel === "GRUPO").map((l) => [l.nome, l.total])).toEqual([
      ["Empréstimos (fora do resultado)", 500_000], ["Investimentos (fora do resultado)", -40_000], ["Pessoal (despesas pessoais pagas pela empresa)", -20_000],
    ]);
    expect(percentualDaReceita(240_000, 1_050_000)).toBe(2285);
  });

  it("regime de caixa: só realizados, pelo mês da baixa, com juros no resultado financeiro", () => {
    const d = montarDreGerencial([
      pag("DESP_MANUTENCAO", 100_000, { situacao: "REALIZADO", pagoEm: "2026-11-03", valorPagoCentavos: 102_000, jurosCentavos: 2_000 }),
      pag("DESP_ALUGUEL", 50_000), // em aberto: não entra no caixa
    ], cats, ["2026-10", "2026-11"], "CAIXA");
    expect(linha(d, "CUSTOS_OPERACAO")?.valores).toEqual([0, -100_000]);
    expect(linha(d, "FINANCEIRO")?.valores).toEqual([0, -2_000]);
    expect(linha(d, "ADMINISTRATIVO")?.total).toBe(0);
    expect(d.resultadoLiquido).toEqual([0, -102_000]);
  });
});
