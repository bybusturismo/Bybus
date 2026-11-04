import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderizar, respostaJson, sessaoFicticia } from "../../teste/ajuda";
import { AVISO_TELA_ABERTA, INTERVALO_ENVIO_MS, Motorista } from "./Motorista";

const saida = { saidaId: "s1", passeio: "Toda a Ilha", data: "2026-11-05", veiculo: "ZZZ0Z00 (fictício)", sessao: null };
const sessaoMotorista = () => sessaoFicticia("MOTORISTA", ["manifesto:ver", "rastreio:transmitir"]);

/** GPS falso: guarda os callbacks para o teste "mover" o ônibus. */
function gpsFalso() {
  const g = { ok: null as null | ((p: unknown) => void), erro: null as null | ((e: { code: number }) => void), opcoes: undefined as unknown, limpou: vi.fn() };
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { watchPosition: vi.fn((ok, erro, opcoes) => { g.ok = ok; g.erro = erro; g.opcoes = opcoes; return 7; }), clearWatch: g.limpou },
  });
  const mover = (lat: number, lng: number, extra: Record<string, unknown> = {}) =>
    act(() => g.ok!({ coords: { latitude: lat, longitude: lng, accuracy: 12, speed: 5, heading: 90, ...extra }, timestamp: Date.now() }));
  return { g, mover };
}

interface Servidor { posicoes: Array<{ lat: number; lng: number }[]>; chamadas: string[]; offline: boolean; resposta409: boolean }
function servidor(saidas: unknown[] = [saida]) {
  const s: Servidor = { posicoes: [], chamadas: [], offline: false, resposta409: false };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (entrada, init) => {
    const url = String(entrada).split("?")[0]!;
    const metodo = (init?.method ?? "GET").toUpperCase();
    s.chamadas.push(`${metodo} ${url}`);
    if (url === "/api/rastreio/minhas-saidas") return respostaJson(200, saidas);
    if (s.offline && url.endsWith("/posicoes")) throw new TypeError("Failed to fetch");
    if (url === "/api/rastreio/saidas/s1/iniciar") return respostaJson(201, { sessaoId: "sess-1", retomada: false });
    if (url.endsWith("/posicoes")) {
      if (s.resposta409) return respostaJson(409, { codigo: "SESSAO_ENCERRADA", mensagem: "Este rastreio já foi encerrado." });
      s.posicoes.push(JSON.parse(String(init!.body)).posicoes);
      return respostaJson(200, { aceitas: 1, descartadas: {} });
    }
    if (url.endsWith("/encerrar")) return respostaJson(200, { ok: true });
    return respostaJson(404, { codigo: "NAO_ENCONTRADO", mensagem: "?" });
  });
  return s;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try { localStorage.clear(); } catch { /* sem armazenamento */ }
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "geolocation");
  Reflect.deleteProperty(navigator, "wakeLock");
});

const ciclo = () => act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_ENVIO_MS); });

describe("Tela do motorista", () => {
  it("mostra o aviso de manter a tela aberta e as saídas dele hoje", async () => {
    gpsFalso();
    servidor();
    renderizar(<Motorista />, { sessao: sessaoMotorista() });
    expect(await screen.findByText("Toda a Ilha")).toBeInTheDocument();
    expect(screen.getByText(AVISO_TELA_ABERTA)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar rastreio" })).toBeEnabled();
  });

  it("sem saída hoje, explica que a escala define quem transmite", async () => {
    servidor([]);
    renderizar(<Motorista />, { sessao: sessaoMotorista() });
    expect(await screen.findByText(/não está escalado como motorista/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /rastreio/ })).not.toBeInTheDocument();
  });

  it("inicia, pede GPS de alta precisão e tela acesa, e envia a fila em lote a cada 15 s", async () => {
    const { g, mover } = gpsFalso();
    const trava = vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: trava } });
    const s = servidor();
    renderizar(<Motorista />, { sessao: sessaoMotorista() });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Iniciar rastreio" }));
    expect(await screen.findByRole("button", { name: "Encerrar rastreio" })).toBeInTheDocument();
    expect(g.opcoes).toMatchObject({ enableHighAccuracy: true });
    expect(trava).toHaveBeenCalledWith("screen");
    expect(screen.getByText(/Aguardando o primeiro sinal/)).toBeInTheDocument();

    await mover(-27.6, -48.5);
    expect(await screen.findByText(/1 na fila para enviar/)).toBeInTheDocument();
    await mover(-27.6001, -48.5001); // menos de 5 s depois: ignorada (a fila não cresce)
    expect(screen.getByText(/1 na fila para enviar/)).toBeInTheDocument();

    await ciclo();
    await waitFor(() => expect(s.posicoes).toHaveLength(1));
    expect(s.posicoes[0]).toHaveLength(1);
    expect(s.posicoes[0]![0]).toMatchObject({ lat: -27.6, lng: -48.5, precisaoM: 12, velocidade: 5, direcao: 90 });
    await waitFor(() => expect(screen.queryByText(/na fila para enviar/)).not.toBeInTheDocument());
  });

  it("sem internet guarda as posições na fila local e envia tudo quando a conexão volta", async () => {
    const { mover } = gpsFalso();
    const s = servidor();
    renderizar(<Motorista />, { sessao: sessaoMotorista() });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Iniciar rastreio" }));
    await screen.findByRole("button", { name: "Encerrar rastreio" });
    s.offline = true;
    await mover(-27.6, -48.5);
    await ciclo();
    expect(await screen.findByText("Sem internet: guardando as posições")).toBeInTheDocument();
    expect(s.posicoes).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("bybus.rastreio.fila.sess-1")!)).toHaveLength(1); // sobrevive a recarregar a página
    s.offline = false;
    await ciclo();
    await waitFor(() => expect(s.posicoes).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(/Sem internet/)).not.toBeInTheDocument());
    expect(localStorage.getItem("bybus.rastreio.fila.sess-1")).toBeNull();
  });

  it("encerrar envia o que sobrou, avisa o servidor e solta o GPS", async () => {
    const { g, mover } = gpsFalso();
    const s = servidor();
    renderizar(<Motorista />, { sessao: sessaoMotorista() });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Iniciar rastreio" }));
    await screen.findByRole("button", { name: "Encerrar rastreio" });
    await mover(-27.6, -48.5);
    await u.click(screen.getByRole("button", { name: "Encerrar rastreio" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar rastreio" })).toBeEnabled());
    const ordem = s.chamadas.filter((c) => c.startsWith("POST"));
    expect(ordem.at(-2)).toBe("POST /api/rastreio/sessoes/sess-1/posicoes");
    expect(ordem.at(-1)).toBe("POST /api/rastreio/sessoes/sess-1/encerrar");
    expect(g.limpou).toHaveBeenCalledWith(7);
  });

  it("GPS bloqueado mostra o motivo em português", async () => {
    const { g } = gpsFalso();
    servidor();
    renderizar(<Motorista />, { sessao: sessaoMotorista() });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Iniciar rastreio" }));
    await screen.findByRole("button", { name: "Encerrar rastreio" });
    act(() => g.erro!({ code: 1 }));
    expect(await screen.findByText(/localização está bloqueada/)).toBeInTheDocument();
  });

  it("sessão encerrada pelo servidor (409) para a transmissão e mostra a mensagem", async () => {
    const { mover } = gpsFalso();
    const s = servidor();
    renderizar(<Motorista />, { sessao: sessaoMotorista() });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Iniciar rastreio" }));
    await screen.findByRole("button", { name: "Encerrar rastreio" });
    s.resposta409 = true;
    await mover(-27.6, -48.5);
    await ciclo();
    expect(await screen.findByText("Este rastreio já foi encerrado.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Encerrar rastreio" })).not.toBeInTheDocument();
  });

  it("quem só tem o checklist vê o atalho do checklist e nada de rastreio", async () => {
    renderizar(<Motorista />, { sessao: sessaoFicticia("MOTORISTA", ["frota:checklist"]) });
    expect(await screen.findByRole("link", { name: /Checklist do veículo/ })).toHaveAttribute("href", "/frota/checklist");
    expect(screen.queryByText(AVISO_TELA_ABERTA)).not.toBeInTheDocument();
  });
});
