import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderizar, respostaJson } from "../../teste/ajuda";
import { FormNovaReserva } from "./Reservas";

const pontos = [{ id: "11111111-1111-4111-8111-111111111111", ordem: 50, horario: "08:00", nome: "Villa Romana Shopping", ehTransfer: false }];

describe("Incluir reserva", () => {
  it("bloqueia CPF inválido no cliente e envia o corpo esperado quando corrigido", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(respostaJson(200, { id: "r1" }));
    const aoSalvar = vi.fn(async () => {});
    renderizar(<FormNovaReserva saidaId="s1" pontos={pontos} aoSalvar={aoSalvar} aoCancelar={vi.fn()} />);
    const u = userEvent.setup();
    await u.selectOptions(screen.getByLabelText("Canal"), "VIATOR");
    await u.type(screen.getByLabelText(/Código no canal/), "VIA-1");
    await u.type(screen.getByLabelText("Titular da reserva"), "Maria Ficticia");
    await u.selectOptions(screen.getByLabelText("Ponto de embarque"), pontos[0]!.id);
    await u.click(screen.getByRole("button", { name: "Usar nome do titular" }));
    await u.selectOptions(screen.getByLabelText("Tipo de documento"), "CPF");
    const doc = screen.getByLabelText("Número do documento");
    await u.type(doc, "11122233300");
    expect(doc).toHaveValue("111.222.333-00");
    await u.click(screen.getByRole("button", { name: "Adicionar passageiro" }));
    const p2 = screen.getByRole("group", { name: "Passageiro 2" });
    await u.selectOptions(within(p2).getByLabelText("Categoria"), "COLO");

    await u.click(screen.getByRole("button", { name: "Salvar reserva" }));
    expect(screen.getByText(/CPF inválido/)).toBeInTheDocument();
    expect(doc).toHaveAttribute("aria-invalid", "true");
    expect(f).not.toHaveBeenCalled();

    await u.clear(doc);
    await u.type(doc, "52998224725");
    await u.click(screen.getByRole("button", { name: "Salvar reserva" }));
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/saidas/s1/reservas");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      canal: "VIATOR",
      codigoExterno: "VIA-1",
      contatoNome: "Maria Ficticia",
      contatoTelefone: null,
      contatoEmail: null,
      pontoEmbarqueId: pontos[0]!.id,
      observacoes: null,
      passageiros: [
        { nome: "Maria Ficticia", categoria: "ADULTO", documentoTipo: "CPF", documento: "529.982.247-25", documentoPais: null },
        { nome: "", categoria: "COLO", documentoTipo: null, documento: null, documentoPais: null },
      ],
    });
    expect(aoSalvar).toHaveBeenCalled();
  });
});
