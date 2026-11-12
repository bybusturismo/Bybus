import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respostaJson } from "../teste/ajuda";
import { ATUALIZAR_PUBLICO_MS, mensagemPrincipal, RastreioPublico } from "./RastreioPublico";

// O mapa real (Leaflet) precisa de layout de navegador: aqui só conferimos o que a página entrega a ele.
vi.mock("../componentes/Mapa", () => ({
  default: (p: { onibus?: { lat: number } | null; pontos?: Array<{ nome: string; destaque?: boolean }> }) => (
    <div data-testid="mapa" data-onibus={p.onibus ? "sim" : "nao"} data-destaque={p.pontos?.find((x) => x.destaque)?.nome ?? ""} />
  ),
}));

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";
const base = {
  passeio: "Toda a Ilha", cidade: "Florianópolis", data: "2026-11-05", situacao: "TRANSMITINDO", minutosSemSinal: null,
  ponto: { nome: "Hotel Fictício", horario: "08:15", lat: -27.6, lng: -48.5 },
  onibus: { lat: -27.59, lng: -48.52, em: "2026-11-05T11:00:00Z" },
  rota: [{ nome: "Hotel Fictício", lat: -27.6, lng: -48.5, passou: false, doCliente: true }],
  previsao: { situacao: "A_CAMINHO", minutos: 12, motivo: null, estimativa: true }, jaPassou: false,
};

let corpo: Record<string, unknown> = base;
let status = 200;
beforeEach(() => {
  corpo = base;
  status = 200;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => respostaJson(status, corpo));
});
afterEach(() => vi.useRealTimers());

describe("Página pública do rastreio", () => {
  it("mostra o ônibus no mapa, o ponto do cliente e quanto falta", async () => {
    render(<RastreioPublico token={TOKEN} />);
    expect(await screen.findByText("O City Tour chega ao seu ponto em")).toBeInTheDocument();
    expect(screen.getByText("~12 min")).toBeInTheDocument();
    expect(screen.getByText(/08:15 — Hotel Fictício/)).toBeInTheDocument();
    const mapa = await screen.findByTestId("mapa");
    expect(mapa).toHaveAttribute("data-onibus", "sim");
    expect(mapa).toHaveAttribute("data-destaque", "Hotel Fictício");
    expect(screen.getByText(/estimativa/)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(`/api/publico/rastreio/${TOKEN}`);
  });

  it("atualiza sozinha a cada 20 segundos", async () => {
    render(<RastreioPublico token={TOKEN} />);
    await screen.findByText("~12 min");
    corpo = { ...base, previsao: { situacao: "A_CAMINHO", minutos: 4, motivo: null, estimativa: true } };
    await act(async () => { await vi.advanceTimersByTimeAsync(ATUALIZAR_PUBLICO_MS); });
    expect(await screen.findByText("~4 min")).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("antes de sair não mostra ônibus nem previsão", async () => {
    corpo = { ...base, situacao: "NAO_INICIADO", onibus: null, previsao: null };
    render(<RastreioPublico token={TOKEN} />);
    expect(await screen.findByText(/O City Tour ainda não saiu/)).toBeInTheDocument();
    expect(screen.getByTestId("mapa")).toHaveAttribute("data-onibus", "nao");
    expect(screen.queryByText(/min$/)).not.toBeInTheDocument();
  });

  it("depois do ponto do cliente diz que já passou", async () => {
    corpo = { ...base, jaPassou: true, previsao: { situacao: "JA_PASSOU", minutos: null, motivo: null, estimativa: true } };
    render(<RastreioPublico token={TOKEN} />);
    expect(await screen.findByText(/já passou pelo seu ponto/)).toBeInTheDocument();
  });

  it("sem sinal avisa há quantos minutos e mostra a última posição", async () => {
    corpo = { ...base, situacao: "SEM_SINAL", minutosSemSinal: 6, previsao: null };
    render(<RastreioPublico token={TOKEN} />);
    expect(await screen.findByText(/Sem sinal do City Tour há 6 min/)).toBeInTheDocument();
    expect(screen.getByTestId("mapa")).toHaveAttribute("data-onibus", "sim");
  });

  it("link inválido ou vencido mostra a mensagem e para de consultar", async () => {
    status = 404;
    corpo = { codigo: "LINK_INVALIDO", mensagem: "Este link não é válido ou já expirou. Fale com a By Bus pelo WhatsApp." };
    render(<RastreioPublico token={TOKEN} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Este link não é válido ou já expirou");
    await act(async () => { await vi.advanceTimersByTimeAsync(ATUALIZAR_PUBLICO_MS * 3); });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("falha de rede mantém a última informação na tela", async () => {
    render(<RastreioPublico token={TOKEN} />);
    await screen.findByText("~12 min");
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => { await vi.advanceTimersByTimeAsync(ATUALIZAR_PUBLICO_MS); });
    await waitFor(() => expect(screen.getByText(/Sem conexão no momento/)).toBeInTheDocument());
    expect(screen.getByText("~12 min")).toBeInTheDocument();
  });

  it("textos por situação (reserva sem ponto e ponto sem coordenadas)", () => {
    const i = { ...base, ponto: null, previsao: { situacao: "SEM_PREVISAO", minutos: null, motivo: "SEM_PONTO", estimativa: true } } as never;
    expect(mensagemPrincipal(i).texto).toMatch(/Não temos o seu ponto/);
    const j = { ...base, previsao: { situacao: "SEM_PREVISAO", minutos: null, motivo: "SEM_COORDENADAS", estimativa: true } } as never;
    expect(mensagemPrincipal(j).texto).toMatch(/previsão para o seu ponto ainda não está disponível/);
    expect(mensagemPrincipal({ ...base, previsao: { situacao: "NO_PONTO", minutos: 0, motivo: null, estimativa: true } } as never).texto).toBe("O City Tour está no seu ponto!");
  });
});
