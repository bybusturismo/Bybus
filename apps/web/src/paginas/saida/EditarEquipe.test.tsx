import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Saida } from "../../api/tipos";
import { BC, corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { EditarEquipe } from "./ListaPassageiros";

const saida: Saida = {
  id: "s1", passeioId: "p1", data: "2026-10-23", status: "PREVISTA", capacidade: 46, veiculo: "QJQ2A16", guia: "Nome antigo digitado", motorista: null,
  guiaId: null, motoristaId: null, observacoes: null, criadoEm: "2026-10-22T00:00:00Z",
};

describe("Veículo e equipe", () => {
  it("escolhe guia e motorista do cadastro (só da praça do passeio ou de todas) e envia os ids", async () => {
    const api = simularApi({
      "GET /api/pessoas": (_: unknown, url: string) =>
        url.includes("papel=GUIA")
          ? [
              { id: "g1", nome: "Guia Fictícia Ana", papeis: ["GUIA"], unidadeId: FLN.id, idiomas: ["Português", "Espanhol"], ativo: true },
              { id: "g2", nome: "Guia de BC", papeis: ["GUIA"], unidadeId: BC.id, idiomas: [], ativo: true },
              { id: "g3", nome: "Guia Volante", papeis: ["GUIA"], unidadeId: null, idiomas: [], ativo: true },
            ]
          : [{ id: "m1", nome: "Motorista Fictício Davi", papeis: ["MOTORISTA"], unidadeId: FLN.id, idiomas: [], ativo: true }],
      "PATCH /api/saidas/s1": { ...saida },
    });
    const aoSalvar = vi.fn(async () => {});
    renderizar(<EditarEquipe saida={saida} unidadeId={FLN.id} aberto aoFechar={vi.fn()} aoSalvar={aoSalvar} />, {
      sessao: sessaoFicticia("SUPERVISOR", ["saidas:gerenciar", "pessoas:ver"]),
    });
    const guia = screen.getByLabelText("Guia");
    await vi.waitFor(() => expect(guia).toBeEnabled());
    expect(within(guia).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "A definir",
      "Nome antigo digitado (digitado antes do cadastro de equipe)",
      "Guia Fictícia Ana (Português, Espanhol)",
      "Guia Volante",
    ]);
    expect(guia).toHaveValue("__texto__");
    const u = userEvent.setup();
    await u.selectOptions(guia, "g1");
    await u.selectOptions(screen.getByLabelText("Motorista"), "m1");
    await u.click(screen.getByRole("button", { name: "Salvar" }));
    expect(corpoEnviado(api, "PATCH", "/api/saidas/s1")).toEqual({ veiculo: "QJQ2A16", capacidade: 46, observacoes: null, guiaId: "g1", motoristaId: "m1" });
    expect(aoSalvar).toHaveBeenCalledWith(false);
  });

  it("sem pessoas:ver mostra a equipe atual e não envia guia/motorista", async () => {
    const api = simularApi({ "PATCH /api/saidas/s1": { ...saida } });
    renderizar(<EditarEquipe saida={saida} unidadeId={FLN.id} aberto aoFechar={vi.fn()} aoSalvar={vi.fn(async () => {})} />, {
      sessao: sessaoFicticia("ATENDENTE", ["saidas:gerenciar"]),
    });
    expect(screen.queryByLabelText("Guia")).not.toBeInTheDocument();
    expect(screen.getByText("Nome antigo digitado")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Salvar" }));
    expect(corpoEnviado(api, "PATCH", "/api/saidas/s1")).toEqual({ veiculo: "QJQ2A16", capacidade: 46, observacoes: null });
  });
});
