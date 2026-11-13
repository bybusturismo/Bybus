import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { PortalAfiliado } from "./PortalAfiliado";

describe("Portal do afiliado (13/11/2026)", () => {
  it("mostra comissões, próximo pagamento e link; cadastra os dados bancários", async () => {
    const spy = simularApi({
      "GET /api/portal-afiliado": {
        afiliado: { nome: "Hotel Fictício Sol", codigo: "PT-777", link: "https://loja.exemplo.test/?ref=PT-777" },
        totais: { previstaCentavos: 250, aPagarCentavos: 750, pagaCentavos: 0 },
        proximoPagamento: { data: "2026-11-16", totalCentavos: 750 },
        comissoes: [{ reservaId: "r1", pedidoCodigo: "PAYTOUR-1", passeio: "Toda a Ilha", dataVenda: "2026-10-02", dataPasseio: "2026-10-20", valorReservaCentavos: 30000, comissaoCentavos: 750, situacao: "A_PAGAR", dataPagamento: "2026-11-01" }],
        pagamentos: [],
        dadosBancarios: null,
      },
      "PUT /api/portal-afiliado/dados-bancarios": { ok: true },
    });
    renderizar(<PortalAfiliado />, { sessao: sessaoFicticia("AFILIADO", ["afiliado:portal"]) });
    expect(await screen.findByRole("heading", { name: "Olá, Hotel Fictício Sol!" })).toBeInTheDocument();
    expect(screen.getByText("https://loja.exemplo.test/?ref=PT-777")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /PAYTOUR-1/ })).toHaveTextContent("A pagar (passeio realizado)");
    expect(screen.getByText(/Cadastre seus dados para receber/)).toBeInTheDocument();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Titular da conta"), "Hotel Fictício Sol");
    await u.type(screen.getByLabelText("CPF ou CNPJ do titular"), "00.000.000/0001-00");
    await u.type(screen.getByLabelText("Chave PIX"), "pix@exemplo.test");
    await u.click(screen.getByRole("button", { name: "Salvar dados" }));
    await screen.findByText("Dados bancários salvos.");
    expect(corpoEnviado(spy, "PUT", "/api/portal-afiliado/dados-bancarios")).toMatchObject({ titular: "Hotel Fictício Sol", pix: "pix@exemplo.test", banco: null });
  });
});
