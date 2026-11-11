import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderizar, simularApi } from "../../teste/ajuda";
import { LeitorVoucher } from "./LeitorVoucher";

describe("Leitor do QR Code do voucher", () => {
  it("sem câmera, aceita o número digitado, mostra quem embarcou e a cobrança", async () => {
    const spy = simularApi({ "POST /api/saidas/s1/embarque/voucher": { embarcados: [{ id: "p1", nome: "Pessoa Fictícia" }], jaEmbarcados: 0, pagamento: "A_PAGAR", valorACobrarCentavos: 17000 } });
    const registrou = vi.fn();
    renderizar(<LeitorVoucher saidaId="s1" aoFechar={() => undefined} aoRegistrar={registrou} />);
    expect(await screen.findByText(/não liberou a câmera/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/número do voucher/), "924074225171781496807");
    await userEvent.click(screen.getByRole("button", { name: "Registrar embarque" }));
    const status = (await screen.findByText(/Embarcou: Pessoa Fictícia/)).closest("[role=status]")!;
    expect(status).toHaveTextContent("Embarcou: Pessoa Fictícia");
    expect(status).toHaveTextContent(/A pagar no embarque: R\$\s?170,00/);
    expect(registrou).toHaveBeenCalled();
    expect(spy.mock.calls.some(([u, i]) => String(u).includes("/embarque/voucher") && JSON.parse(String(i?.body)).codigo === "924074225171781496807")).toBe(true);
  });
});
