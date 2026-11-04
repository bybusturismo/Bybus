import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { Rastreamento } from "./Rastreamento";

vi.mock("../../componentes/Mapa", () => ({
  default: (p: { onibus?: unknown; pontos?: unknown[]; trajeto?: unknown[] }) => <div data-testid="mapa" data-onibus={p.onibus ? "sim" : "nao"} data-pontos={p.pontos?.length} data-trajeto={p.trajeto?.length} />,
}));

const base = { data: "2026-11-05", motorista: "Motorista Fictício Davi", veiculo: "ZZZ0Z00 (fictício)", sessao: null, ultimaPosicao: null };
const lista = [
  { ...base, saidaId: "s1", passeio: "Toda a Ilha", situacao: "SEM_SINAL", minutosSemSinal: 7, sessao: { id: "x1", iniciadaEm: "2026-11-05T11:00:00Z", encerradaEm: null }, ultimaPosicao: { lat: -27.6, lng: -48.5, em: "2026-11-05T11:30:00Z" }, pontos: { total: 3, comCoordenadas: 2 } },
  { ...base, saidaId: "s2", passeio: "City Tour BC", situacao: "NAO_INICIADO", minutosSemSinal: null, pontos: { total: 2, comCoordenadas: 0 } },
];
const detalhe = {
  ...lista[0], pontos: [
    { id: "p1", nome: "Ponto A", horario: "08:00", lat: -27.6, lng: -48.5, passou: true },
    { id: "p2", nome: "Ponto B", horario: "08:10", lat: -27.61, lng: -48.49, passou: false },
    { id: "p3", nome: "Ponto C", horario: "08:20", lat: null, lng: null, passou: false },
  ],
  trajeto: [{ lat: -27.6, lng: -48.5, em: "2026-11-05T11:20:00Z" }, { lat: -27.6, lng: -48.51, em: "2026-11-05T11:30:00Z" }],
};

describe("Rastreamento (equipe)", () => {
  it("lista as saídas com a situação do sinal e abre o mapa da primeira", async () => {
    simularApi({ "GET /api/rastreio/saidas": lista, "GET /api/rastreio/saidas/s1": detalhe });
    renderizar(<Rastreamento />, { sessao: sessaoFicticia("SUPERVISOR", ["manifesto:ver", "saidas:decidir", "produtos:gerenciar"]) });
    const itens = await screen.findByRole("list", { name: "Saídas do dia" });
    expect(within(itens).getByText("Sem sinal há 7 min")).toBeInTheDocument();
    expect(within(itens).getByText("Não iniciado")).toBeInTheDocument();
    const mapa = await screen.findByTestId("mapa");
    expect(mapa).toHaveAttribute("data-onibus", "sim");
    expect(mapa).toHaveAttribute("data-pontos", "2"); // o ponto sem coordenadas fica fora do mapa
    expect(mapa).toHaveAttribute("data-trajeto", "2");
    expect(screen.getByText(/1 de 3 ponto\(s\) sem coordenadas/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Cadastrar em Passeios e pontos/ })).toBeInTheDocument();
    expect(screen.getByText(/Sem sinal do celular do motorista há 7 min/)).toBeInTheDocument();
  });

  it("escolher outra saída avisa que o motorista ainda não iniciou", async () => {
    simularApi({
      "GET /api/rastreio/saidas": lista, "GET /api/rastreio/saidas/s1": detalhe,
      "GET /api/rastreio/saidas/s2": { ...lista[1], pontos: [], trajeto: [] },
    });
    renderizar(<Rastreamento />, { sessao: sessaoFicticia("SUPERVISOR", ["manifesto:ver"]) });
    await userEvent.setup().click(await screen.findByRole("button", { name: /City Tour BC/ }));
    expect(await screen.findByText(/ainda não iniciou o rastreio/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Encerrar rastreio" })).not.toBeInTheDocument();
  });

  it("quem decide saídas pode encerrar um rastreio aberto", async () => {
    const api = simularApi({ "GET /api/rastreio/saidas": lista, "GET /api/rastreio/saidas/s1": detalhe, "POST /api/rastreio/sessoes/x1/encerrar": { ok: true } });
    renderizar(<Rastreamento />, { sessao: sessaoFicticia("SUPERVISOR", ["manifesto:ver", "saidas:decidir"]) });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Encerrar rastreio" }));
    await vi.waitFor(() => expect(corpoEnviado(api, "POST", "/api/rastreio/sessoes/x1/encerrar")).toEqual({}));
  });
});
