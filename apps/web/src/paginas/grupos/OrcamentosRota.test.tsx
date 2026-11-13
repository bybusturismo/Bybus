import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { OrcamentoRotaFicha, OrcamentosRota } from "./OrcamentosRota";

const sessao = sessaoFicticia("SUPERVISOR", ["reservas:editar"], { unidades: [FLN] });
const calculo = { distanciaKm: 40, duracaoMin: 60, cargaHorariaMin: 120, fonte: "OPENROUTESERVICE", preco: { porKmCentavos: 36000, porHoraCentavos: 60000, horasCobradas: 5, totalCentavos: 100000, aplicouMinimo: true } };

describe("Orçamento com rota (13/11/2026)", () => {
  it("lista com número, valor e link do grupo", async () => {
    simularApi({ "GET /api/orcamentos-rota": [{ id: "o1", numero: "2026-0001", cliente: "Escola Fictícia", contato: null, grupoId: "g1", dataPasseio: "2027-04-10", veiculo: "ONIBUS", pessoas: 40, distanciaKm: 40.5, valorCalculadoCentavos: 100000, valorFinalCentavos: 120000 }] });
    renderizar(<OrcamentosRota />, { sessao });
    expect(await screen.findByRole("link", { name: "2026-0001" })).toHaveAttribute("href", "/orcamentos-rota/o1");
    expect(screen.getByRole("row", { name: /Escola Fictícia/ })).toHaveTextContent("R$ 1.200,00");
    expect(screen.getByRole("link", { name: "Ver grupo" })).toHaveAttribute("href", "/grupos/g1");
  });

  it("procura os pontos, calcula a rota e cria o orçamento com o valor ajustado", async () => {
    const spy = simularApi({
      "POST /api/orcamentos-rota/localizar": [{ nome: "Ponto fictício", lat: -27.59, lng: -48.54, fonte: "CADASTRO" }],
      "POST /api/orcamentos-rota/calcular": calculo,
      "POST /api/orcamentos-rota": { id: "o9", numero: "2026-0009" },
      "GET /api/orcamentos-rota/o9": { id: "o9", numero: "2026-0009", cliente: "Empresa Fictícia", veiculo: "ONIBUS", pontos: [], folgaMin: 30, validadeDias: 15, grupoId: null },
    });
    renderizar(<Routes><Route path="/orcamentos-rota/:id" element={<OrcamentoRotaFicha />} /></Routes>, { sessao, rota: "/orcamentos-rota/novo" });
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Cliente (escola, empresa, grupo)"), "Empresa Fictícia");
    await u.type(screen.getByLabelText("Pessoas"), "40");
    for (let i = 0; i < 2; i++) {
      await u.type(screen.getByLabelText("Adicionar ponto"), "Ponto");
      await u.click(screen.getByRole("button", { name: /Procurar/ }));
      await u.click(await screen.findByRole("button", { name: /^\s*Ponto fictício$/ }));
    }
    expect(screen.getByLabelText("Permanência no ponto 2")).toHaveValue(30);
    expect(await screen.findByText("pelas ruas (OpenRouteService)", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("valor mínimo do veículo")).toBeInTheDocument();
    await u.type(screen.getByLabelText("Valor final (R$)"), "1.200,00");
    expect(screen.getByText(/Total do orçamento: R\$ 1\.200,00/).parentElement).toHaveTextContent("R$ 30,00 por pessoa");
    await u.click(screen.getByRole("button", { name: "Criar orçamento" }));
    await screen.findByText("Orçamento 2026-0009 criado.");
    expect(corpoEnviado(spy, "POST", "/api/orcamentos-rota")).toMatchObject({ cliente: "Empresa Fictícia", veiculo: "ONIBUS", pessoas: 40, valorFinalCentavos: 120000, pontos: [{ permanenciaMin: 0 }, { permanenciaMin: 30 }] });
  });
});
