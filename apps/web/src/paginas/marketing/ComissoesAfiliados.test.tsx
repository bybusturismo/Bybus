import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { ComissoesAfiliados, datasDePagamento } from "./ComissoesAfiliados";

describe("Comissões de afiliados (13/11/2026)", () => {
  it("datas de pagamento: dias 01 e 16 já alcançados, da mais recente", () => {
    expect(datasDePagamento("2026-11-13", 4)).toEqual(["2026-11-01", "2026-10-16", "2026-10-01", "2026-09-16"]);
    expect(datasDePagamento("2026-11-16", 3)).toEqual(["2026-11-16", "2026-11-01", "2026-10-16"]);
    expect(datasDePagamento("2027-01-05", 3)).toEqual(["2027-01-01", "2026-12-16", "2026-12-01"]);
  });

  it("mostra ranking, comissões e gera o pagamento quinzenal", async () => {
    const spy = simularApi({
      "GET /api/afiliados/comissoes": {
        itens: [{ reservaId: "r1", pedidoCodigo: "PAYTOUR-1", afiliadoId: "a1", afiliadoNome: "Hotel Fictício Sol", passeio: "Toda a Ilha", dataVenda: "2026-10-02", dataPasseio: "2026-10-20", valorReservaCentavos: 30000, comissaoCentavos: 3000, situacao: "A_PAGAR", dataPagamento: "2026-11-01", pagamentoId: null }],
        totais: { previstaCentavos: 0, aPagarCentavos: 3000, pagaCentavos: 0, canceladaCentavos: 0 },
        ranking: [{ afiliadoId: "a1", nome: "Hotel Fictício Sol", reservas: 1, vendidoCentavos: 30000, comissaoCentavos: 3000 }],
        proximoPagamento: { data: "2026-11-16", pendentes: 1, totalCentavos: 3000 },
      },
      "GET /api/afiliados/pagamentos": [],
      "POST /api/afiliados/pagamentos": { pagamentos: 1, comissoes: 1, totalCentavos: 3000 },
    });
    renderizar(<ComissoesAfiliados />, { sessao: sessaoFicticia("FIN", ["marketing:ver", "financeiro:ver", "financeiro:gerenciar"], { unidades: [FLN] }) });
    const ranking = within(await screen.findByRole("region", { name: "Ranking dos afiliados" }));
    expect(ranking.getByRole("row", { name: /1º Hotel Fictício Sol/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /PAYTOUR-1/ })).toHaveTextContent("A pagar (passeio realizado)");
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Gerar contas a pagar" }));
    expect(await screen.findByText(/1 conta\(s\) a pagar criada\(s\) no financeiro/)).toBeInTheDocument();
    expect(corpoEnviado(spy, "POST", "/api/afiliados/pagamentos")).toHaveProperty("dataPagamento");
  });

  it("quem não gerencia o financeiro não vê o botão de gerar", async () => {
    simularApi({
      "GET /api/afiliados/comissoes": { itens: [], totais: { previstaCentavos: 0, aPagarCentavos: 0, pagaCentavos: 0, canceladaCentavos: 0 }, ranking: [], proximoPagamento: { data: "2026-11-16", pendentes: 0, totalCentavos: 0 } },
      "GET /api/afiliados/pagamentos": [],
    });
    renderizar(<ComissoesAfiliados />, { sessao: sessaoFicticia("MKT", ["marketing:ver"], { unidades: [FLN] }) });
    expect(await screen.findByText(/Próximo pagamento/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gerar contas a pagar" })).not.toBeInTheDocument();
  });
});
