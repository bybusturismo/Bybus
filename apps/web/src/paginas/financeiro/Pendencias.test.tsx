import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { PendenciasPlanilha } from "./Pendencias";

const CATS = [{ id: "11111111-1111-4111-8111-111111111111", codigo: "DESP_OUTRAS", nome: "Outras despesas", tipo: "DESPESA", grupo: "Administrativo", ativa: true }];

describe("Pendências de categoria da planilha", () => {
  it("lista o que ficou para depois e aplica a categoria escolhida", async () => {
    const api = simularApi({
      "GET /api/financeiro/planilha/pendencias": { itens: [{ chave: "AGENDA|LEMBRETE", grupo: "AGENDA", categoria: "LEMBRETE", qtd: 2, totalCentavos: 2000, abas: 1 }], abas: [{ id: "a1", arquivo: "outubro.csv", unidadeId: null, atualizadoEm: "2026-11-09T18:00:00Z", linhas: 2 }] },
      "GET /api/financeiro/categorias": CATS,
      "POST /api/financeiro/planilha/pendencias/resolver": { lancamentos: 2, transferencias: 0, abas: 1, restantes: 0 },
    });
    renderizar(<PendenciasPlanilha />, { sessao: sessaoFicticia("ADMIN", ["financeiro:ver", "financeiro:gerenciar"]) });
    const select = await screen.findByLabelText(/AGENDA › LEMBRETE/);
    const u = userEvent.setup();
    expect(screen.getByRole("button", { name: /Aplicar/ })).toBeDisabled();
    await u.selectOptions(select, "Outras despesas");
    await u.click(screen.getByRole("button", { name: "Aplicar 1 escolha" }));
    expect(corpoEnviado(api, "POST", "/api/financeiro/planilha/pendencias/resolver")).toEqual({ mapeamentos: { "AGENDA|LEMBRETE": CATS[0]!.id }, salvarSinonimos: true });
  });

  it("sem pendências mostra que está tudo classificado", async () => {
    simularApi({ "GET /api/financeiro/planilha/pendencias": { itens: [], abas: [] }, "GET /api/financeiro/categorias": CATS });
    renderizar(<PendenciasPlanilha />, { sessao: sessaoFicticia("ADMIN", ["financeiro:ver"]) });
    expect(await screen.findByText("Nenhuma pendência.")).toBeInTheDocument();
  });
});
