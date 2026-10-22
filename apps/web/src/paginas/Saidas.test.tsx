import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { Passeio, SaidaResumo } from "../api/tipos";
import { BC, corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { hojeIso, somarDias } from "../util/formato";
import { Saidas } from "./Saidas";

const passeio = (id: string, nome: string, unidadeId: string, linha: Passeio["linha"]): Passeio => ({
  id, codigo: id.toUpperCase(), nome, cidade: "Cidade", unidadeId, linha, capacidadePadrao: 46, minimoConfirmacao: 12, minimoSupervisor: 10, ativo: true,
});
const PASSEIOS = [
  passeio("p-fln", "City Tour Toda Ilha", FLN.id, "CITY_TOUR"),
  passeio("p-bc", "City Tour BC", BC.id, "CITY_TOUR"),
  passeio("p-bc-fret", "Fretamento Escolar", BC.id, "FRETAMENTO"),
];
const hoje = hojeIso();
const saida = (id: string, p: Passeio, data: string): SaidaResumo => ({
  id, data, status: "PREVISTA", capacidade: 46, veiculo: null, guia: "Guia Fictícia Ana", motorista: null, guiaId: "g1", motoristaId: null,
  passeio: p.nome, passeioId: p.id, linha: p.linha, unidadeId: p.unidadeId, reservas: 2, passageiros: 5, assentos: 5, pagantes: 4,
});

describe("Saídas por praça", () => {
  beforeEach(() => localStorage.clear());

  it("filtra pela praça do topo, mostra a linha de negócio e cria saída escolhendo o passeio", async () => {
    const api = simularApi({
      "GET /api/passeios": PASSEIOS,
      "GET /api/saidas": [saida("s1", PASSEIOS[2]!, somarDias(hoje, 1))],
      "POST /api/saidas": { id: "nova" },
    });
    renderizar(<Saidas />, { sessao: sessaoFicticia("ADMIN", ["manifesto:ver", "saidas:gerenciar"], { unidades: [BC, FLN], praca: BC.id, todasUnidades: true }) });

    expect(await screen.findByText("Fretamento Escolar", { selector: ".saida__passeio" })).toBeInTheDocument();
    expect(screen.getAllByText("Fretamento", { selector: ".etiqueta" })).toHaveLength(1);
    expect(screen.getByText(/Guia: Guia Fictícia Ana/)).toBeInTheDocument();
    const urlSaidas = api.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith("/api/saidas"))!;
    expect(urlSaidas).toContain(`unidadeId=${BC.id}`);

    // Só passeios da praça escolhida no filtro e no "Nova saída de".
    const filtro = screen.getByLabelText("Passeio");
    expect(within(filtro).getAllByRole("option").map((o) => o.textContent)).toEqual(["Todos os passeios", "City Tour BC", "Fretamento Escolar"]);
    const u = userEvent.setup();
    await u.selectOptions(screen.getByLabelText("Nova saída de"), "p-bc-fret");
    await u.type(screen.getByLabelText("em"), somarDias(hoje, 3));
    await u.click(screen.getByRole("button", { name: "Criar saída" }));
    expect(corpoEnviado(api, "POST", "/api/saidas")).toEqual({ passeioId: "p-bc-fret", data: somarDias(hoje, 3) });
  });

  it("todas as praças: agrupa passeios por praça e indica a praça de cada saída", async () => {
    simularApi({ "GET /api/passeios": PASSEIOS, "GET /api/saidas": [saida("s1", PASSEIOS[0]!, hoje)] });
    renderizar(<Saidas />, { sessao: sessaoFicticia("ADMIN", ["manifesto:ver", "saidas:gerenciar"], { unidades: [BC, FLN], praca: "", todasUnidades: true }) });
    expect(await screen.findByText(/^City Tour Toda Ilha/, { selector: ".saida__passeio" })).toBeInTheDocument();
    expect(screen.getByText("· FLN")).toBeInTheDocument();
    const grupos = within(screen.getByLabelText("Nova saída de")).getAllByRole("group");
    expect(grupos.map((g) => g.getAttribute("label"))).toEqual(["Balneário Camboriú", "Florianópolis"]);
  });

  it("praça sem passeio mostra orientação", async () => {
    simularApi({ "GET /api/passeios": [PASSEIOS[0]], "GET /api/saidas": [] });
    renderizar(<Saidas />, { sessao: sessaoFicticia("ADMIN", ["manifesto:ver", "produtos:gerenciar"], { unidades: [BC, FLN], praca: BC.id }) });
    expect(await screen.findByText("Nenhum passeio cadastrado nesta praça.")).toBeInTheDocument();
  });
});
