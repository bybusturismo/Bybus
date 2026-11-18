import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { corpoEnviado, FLN, renderizar, respostaJson, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { KmDiarioPagina, type RegistroKmDiario } from "./KmDiario";

const veiculos = [
  { id: "v1", placa: "ABC1D23", apelido: "Amarelo", tipo: "ONIBUS_DOIS_ANDARES", kmAtual: 120_000, situacao: "ATIVO", feitoHoje: false, aprovadoHoje: null },
  { id: "v2", placa: "XYZ9K88", apelido: null, tipo: "VAN", kmAtual: 50_000, situacao: "ATIVO", feitoHoje: false, aprovadoHoje: null },
];
const reg = (extra: Partial<RegistroKmDiario> = {}): RegistroKmDiario => ({
  id: "k1", veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo", data: "2026-11-17", kmInicial: 119_800, kmFinal: 120_000, consumoLitros: 40, observacao: null,
  lancadoPor: "Motorista Fictício", kmRodado: 200, kml: 5, diferencaAnterior: null, ...extra,
});
const lista = {
  itens: [reg(), reg({ id: "k2", data: "2026-11-18", kmInicial: 120_030, kmFinal: 120_100, consumoLitros: null, kmRodado: 70, kml: null, diferencaAnterior: 30 })],
  resumo: [{ veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo", dias: 2, kmRodado: 270, litros: 40, mediaKml: 5 }],
};
const motorista = sessaoFicticia("MOTORISTA", ["frota:checklist"], { unidades: [FLN] });
const gerente = sessaoFicticia("ADMIN", ["frota:ver", "frota:gerenciar"], { unidades: [FLN] });

describe("Diário de km", () => {
  it("lista data, placa, km inicial, km final, km rodado, consumo e km/l, com o resumo e o aviso de km sem registro", async () => {
    simularApi({ "GET /api/frota/checklist/veiculos": veiculos, "GET /api/frota/km-diario": lista });
    renderizar(<KmDiarioPagina />, { sessao: gerente });
    const tabela = await screen.findByRole("table", { name: "Diário de km" });
    const linhas = within(tabela).getAllByRole("row");
    expect(linhas[0]).toHaveTextContent(/Data.*Placa.*Km inicial.*Km final.*Km rodado.*Consumo \(L\).*km\/l/);
    expect(linhas[1]).toHaveTextContent(/17\/11\/2026.*ABC1D23.*119\.800.*120\.000.*200.*40.*5/);
    expect(within(tabela).getByText("30 km sem registro antes")).toBeInTheDocument();
    expect(screen.getByText("270 km")).toBeInTheDocument();
    expect(within(tabela).getAllByRole("button", { name: /Corrigir km/ })).toHaveLength(2);
  });

  it("motorista lança: km inicial sugerido, km rodado e km/l calculados na hora; não vê Corrigir", async () => {
    const spy = simularApi({
      "GET /api/frota/checklist/veiculos": veiculos,
      "GET /api/frota/km-diario": lista,
      "GET /api/frota/km-diario/sugestao": { kmInicial: 120_100, origem: "km final de 18/11/2026", jaRegistrado: false },
      "POST /api/frota/km-diario": { id: "k3" },
    });
    renderizar(<KmDiarioPagina />, { sessao: motorista });
    const u = userEvent.setup();
    await screen.findByRole("table", { name: "Diário de km" });
    expect(screen.queryByRole("button", { name: /Corrigir km/ })).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /Lançar km do dia/ }));
    const d = within(await screen.findByRole("dialog"));
    expect(await d.findByDisplayValue("120.100")).toBeInTheDocument();
    expect(d.getByText(/Sugerido: km final de 18\/11\/2026/)).toBeInTheDocument();
    await u.type(d.getByLabelText("Km final"), "120.330");
    await u.type(d.getByLabelText("Consumo (litros)"), "46");
    expect(d.getByText(/Km rodado:/)).toHaveTextContent("230 km");
    expect(d.getByText(/Km rodado:/)).toHaveTextContent("5 km/l");
    await u.click(d.getByRole("button", { name: "Salvar" }));
    await screen.findByText("Km do dia lançado.");
    expect(corpoEnviado(spy, "POST", "/api/frota/km-diario")).toMatchObject({ veiculoId: "v1", kmInicial: 120_100, kmFinal: 120_330, consumoLitros: 46 });
  });

  it("km fora de sequência: mostra o aviso e salva só ao confirmar", async () => {
    let posts = 0;
    const corpos: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada, init) => {
      const url = String(entrada).split("?")[0];
      const metodo = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/frota/checklist/veiculos") return respostaJson(200, veiculos);
      if (url === "/api/frota/km-diario" && metodo === "GET") return respostaJson(200, lista);
      if (url === "/api/frota/km-diario/sugestao") return respostaJson(200, { kmInicial: 120_100, origem: "km final de 18/11/2026", jaRegistrado: false });
      if (url === "/api/frota/km-diario" && metodo === "POST") {
        corpos.push(JSON.parse(String(init?.body)));
        return ++posts === 1
          ? respostaJson(409, { codigo: "KM_FORA_DE_SEQUENCIA", mensagem: "O km inicial (120.000) é menor que o km final de 18/11/2026 (120.100). Confira a digitação." })
          : respostaJson(201, { id: "k3" });
      }
      return respostaJson(404, { codigo: "NAO_ENCONTRADO", mensagem: url });
    });
    renderizar(<KmDiarioPagina />, { sessao: motorista });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: /Lançar km do dia/ }));
    const d = within(await screen.findByRole("dialog"));
    await d.findByDisplayValue("120.100");
    await u.clear(d.getByLabelText("Km inicial"));
    await u.type(d.getByLabelText("Km inicial"), "120000");
    await u.type(d.getByLabelText("Km final"), "120200");
    await u.click(d.getByRole("button", { name: "Salvar" }));
    expect(await d.findByText(/menor que o km final de 18\/11\/2026/)).toBeInTheDocument();
    await u.click(d.getByRole("button", { name: "Confirmar e salvar" }));
    await screen.findByText("Km do dia lançado.");
    expect(corpos[0]).not.toHaveProperty("confirmarRecuo");
    expect(corpos[1]).toMatchObject({ kmInicial: 120_000, kmFinal: 120_200, confirmarRecuo: true });
  });
});
