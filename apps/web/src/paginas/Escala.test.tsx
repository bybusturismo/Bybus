import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Passeio } from "../api/tipos";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { somarMes } from "../util/formato";
import { Escala } from "./Escala";

const passeio: Passeio = { id: "p1", codigo: "TODA_ILHA", nome: "City Tour Toda Ilha", cidade: "Florianópolis", unidadeId: FLN.id, linha: "CITY_TOUR", capacidadePadrao: 73, minimoConfirmacao: 12, minimoSupervisor: 10, ativo: true };
const dia = (data: string, extra: Record<string, unknown> = {}) => ({ data, guiaId: null, guia: null, motoristaId: null, motorista: null, origem: null, motivo: null, publicada: false, saida: null, alertas: [], ...extra });

describe("Escala de guias", () => {
  it("navega entre meses", () => {
    expect(somarMes("2026-12", 1)).toBe("2027-01");
    expect(somarMes("2026-01", -1)).toBe("2025-12");
  });

  it("planeja dias livres, mostra a troca e publica", async () => {
    const api = simularApi({
      "GET /api/passeios": [passeio],
      "GET /api/escala/equipe": { guias: [{ id: "g1", nome: "Guia Fictícia Ana", cadasturValidade: null }, { id: "g2", nome: "Guia Fictícia Bia", cadasturValidade: null }], motoristas: [{ id: "m1", nome: "Motorista Fictício Davi" }] },
      "GET /api/escala": {
        passeio: { id: "p1", nome: passeio.nome, unidadeId: FLN.id, motoristaPadraoId: "m1", motoristaPadrao: "Motorista Fictício Davi", veiculoPadrao: null },
        dias: [dia("2099-01-01", { guiaId: "g1", guia: "Guia Fictícia Ana", publicada: true, origem: "TROCA", motivo: "Guia com febre" }), dia("2099-01-02")],
      },
      "PUT /api/escala": { ok: true },
    });
    renderizar(<Escala />, { sessao: sessaoFicticia("SUPERVISOR", ["pessoas:ver", "escala:gerenciar", "manifesto:ver"], { unidades: [FLN] }) });
    expect(await screen.findByText("Troca: Guia com febre")).toBeInTheDocument();
    const u = userEvent.setup();
    const linhaLivre = screen.getAllByRole("row")[2]!;
    await u.selectOptions(within(linhaLivre).getAllByRole("combobox")[0]!, "g2");
    await u.click(screen.getByRole("button", { name: /Publicar escala/ }));
    expect(corpoEnviado(api, "PUT", "/api/escala")).toMatchObject({ passeioId: "p1", publicar: true, motoristaPadraoId: "m1", dias: [{ data: "2099-01-02", guiaId: "g2", motoristaId: null }] });
  });
});
