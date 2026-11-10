import { PLANO_CATEGORIAS, montarDreGerencial, type CategoriaInfo } from "@bybus/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { Dre } from "./Dre";

const gerente = () => sessaoFicticia("FIN", ["financeiro:ver"], { unidades: [FLN] });
const cats = new Map<string, CategoriaInfo>(PLANO_CATEGORIAS.map((c, i) => [c.codigo, { nome: c.nome, tipo: c.tipo, grupo: c.grupo, ordem: i }]));
const base = { situacao: "ABERTO" as const, valorPagoCentavos: null, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0, vencimento: "2026-10-10", pagoEm: null, unidadeId: null, linha: null, competencia: "2026-10-05" };
const meses = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
const dre = montarDreGerencial([
  { ...base, tipo: "RECEBER", categoriaId: "REC_SITE_PAYTOUR", valorCentavos: 1_000_000 },
  { ...base, tipo: "PAGAR", categoriaId: "DESP_COMISSOES", valorCentavos: 100_000 },
  { ...base, tipo: "PAGAR", categoriaId: "DESP_COMBUSTIVEL", valorCentavos: 300_000 },
  { ...base, tipo: "PAGAR", categoriaId: "DESP_CONSORCIO", valorCentavos: 50_000 },
], cats, meses, "COMPETENCIA");

describe("Aba DRE", () => {
  it("mostra os subtotais em cascata, só os meses com valores, o abaixo da linha e abre as categorias do grupo", async () => {
    simularApi({ "GET /api/financeiro/dre": dre, "GET /api/financeiro/lancamentos": { hoje: "2026-11-10", itens: [], total: 0, somaDevidoCentavos: 0, somaAbertoCentavos: 0, somaRealizadoCentavos: 0 } });
    renderizar(<Dre />, { sessao: gerente(), rota: "/financeiro/dre" });
    const tabela = within(await screen.findByRole("table"));
    expect(tabela.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Linha", expect.stringMatching(/out/i), "Acumulado", "% receita"]);
    expect(tabela.getByRole("row", { name: /Margem de contribuição/ })).toHaveTextContent(/9\.000,00/);
    expect(tabela.getByRole("row", { name: /= Lucro bruto/ })).toHaveTextContent(/6\.000,00/);
    expect(tabela.getByRole("row", { name: /Investimentos/ })).toHaveTextContent(/500,00/);
    expect(tabela.queryByRole("row", { name: /^Combustível \(posto BC\)|^Combustível R\$/ })).not.toBeInTheDocument();
    await userEvent.click(tabela.getByRole("button", { name: /Combustível/ }));
    expect(tabela.getByRole("button", { name: /Ver lançamentos de Combustível em/ })).toBeInTheDocument();
    expect(screen.getByText("Resultado líquido").closest(".indicador")).toHaveTextContent(/6\.000,00/);
  });
});
