import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Passeio } from "../api/tipos";
import { lerCoordenada, lerParCoordenadas } from "../util/geolocalizacao";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { PontosDoPasseio } from "./PontosDoPasseio";

const passeio: Passeio = { id: "p1", codigo: "TODA_ILHA", nome: "Toda a Ilha", cidade: "Florianópolis", unidadeId: FLN.id, linha: "CITY_TOUR", capacidadePadrao: 73, minimoConfirmacao: 12, minimoSupervisor: 10, ativo: true };
const pontos = [
  { id: "a", ordem: 10, horario: "08:00", nome: "Ponto A", ehTransfer: false, ativo: true, latitude: null, longitude: null },
  { id: "b", ordem: 20, horario: "08:10", nome: "Ponto B", ehTransfer: false, ativo: true, latitude: -27.6, longitude: -48.5 },
];

describe("coordenadas coladas do Google Maps", () => {
  it("lê números e pares, com ponto ou vírgula", () => {
    expect(lerCoordenada("-27,5954")).toBe(-27.5954);
    expect(lerCoordenada("abc")).toBeNull();
    expect(lerCoordenada("")).toBeNull();
    expect(lerParCoordenadas("-27.5954, -48.5480")).toEqual({ lat: -27.5954, lng: -48.548 });
    expect(lerParCoordenadas("-27,5954; -48,5480")).toEqual({ lat: -27.5954, lng: -48.548 });
    expect(lerParCoordenadas("-27.5954")).toBeNull();
  });
});

describe("Pontos do passeio", () => {
  it("explica como copiar do Google Maps e mostra quantos pontos faltam", async () => {
    simularApi({ "GET /api/passeios/p1/pontos": pontos });
    renderizar(<PontosDoPasseio passeio={passeio} />, { sessao: sessaoFicticia("SUPERVISOR", ["manifesto:ver", "pontos:gerenciar"]) });
    expect(await screen.findByText(/clique com o botão direito no local do ponto/)).toBeInTheDocument();
    expect(screen.getByText("1 de 2 ponto(s) ainda sem coordenadas.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Latitude de Ponto B/)).toHaveValue("-27.6");
  });

  it("colar o par do Google Maps preenche latitude e longitude e salva", async () => {
    const api = simularApi({ "GET /api/passeios/p1/pontos": pontos, "PATCH /api/pontos/a": { ...pontos[0], latitude: -27.5954, longitude: -48.548 } });
    renderizar(<PontosDoPasseio passeio={passeio} />, { sessao: sessaoFicticia("SUPERVISOR", ["manifesto:ver", "pontos:gerenciar"]) });
    const u = userEvent.setup();
    const lat = await screen.findByLabelText(/Latitude de Ponto A/);
    await u.click(lat);
    await u.paste("-27.5954, -48.5480");
    expect(lat).toHaveValue("-27.5954");
    expect(screen.getByLabelText(/Longitude de Ponto A/)).toHaveValue("-48.548");
    await u.click(screen.getByRole("button", { name: "Salvar coordenadas de Ponto A" }));
    await screen.findByText(/Coordenadas de “Ponto A” salvas/);
    expect(corpoEnviado(api, "PATCH", "/api/pontos/a")).toEqual({ latitude: -27.5954, longitude: -48.548 });
  });

  it("recusa texto e fora da faixa antes de chamar a API; apagar os dois limpa", async () => {
    const api = simularApi({ "GET /api/passeios/p1/pontos": pontos, "PATCH /api/pontos/b": { ...pontos[1], latitude: null, longitude: null } });
    renderizar(<PontosDoPasseio passeio={passeio} />, { sessao: sessaoFicticia("SUPERVISOR", ["manifesto:ver", "pontos:gerenciar"]) });
    const u = userEvent.setup();
    const lat = await screen.findByLabelText(/Latitude de Ponto B/);
    await u.clear(lat);
    await u.type(lat, "91");
    await u.click(screen.getByRole("button", { name: "Salvar coordenadas de Ponto B" }));
    expect(await screen.findByText("A latitude vai de -90 a 90.")).toBeInTheDocument();
    await u.clear(lat);
    await u.type(lat, "abc");
    await u.click(screen.getByRole("button", { name: "Salvar coordenadas de Ponto B" }));
    expect(await screen.findByText(/Use números/)).toBeInTheDocument();
    expect(api.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(false);
    await u.clear(lat);
    await u.clear(screen.getByLabelText(/Longitude de Ponto B/));
    await u.click(screen.getByRole("button", { name: "Salvar coordenadas de Ponto B" }));
    await screen.findByText(/Coordenadas de “Ponto B” salvas/);
    expect(corpoEnviado(api, "PATCH", "/api/pontos/b")).toEqual({ latitude: null, longitude: null });
  });

  it("sem pontos:gerenciar os campos ficam só para leitura", async () => {
    simularApi({ "GET /api/passeios/p1/pontos": pontos });
    renderizar(<PontosDoPasseio passeio={passeio} />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver"]) });
    expect(await screen.findByLabelText(/Latitude de Ponto B/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Salvar coordenadas/ })).not.toBeInTheDocument();
  });
});
