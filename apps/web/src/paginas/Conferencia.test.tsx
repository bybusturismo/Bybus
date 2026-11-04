import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ItemConferencia } from "../api/tipos";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { Conferencia, resumoCategorias } from "./Conferencia";
import { Fechamento } from "./Fechamento";

const item: ItemConferencia = {
  id: "r1", saidaId: "s1", data: "2099-01-05", passeio: "City Tour Toda Ilha", passeioId: "p1", canal: "VIATOR", codigoExterno: "VIA-0001",
  contatoNome: "Titular Fictício", contatoTelefone: null, passageiros: 3, categorias: { ADULTO: 2, INFANTIL: 1 }, pagamento: "A_PAGAR", formaPagamento: "Pagar no dia",
  origemCliente: "RS", ponto: null, hospedagemInformada: "Hotel Fictício", pediuTransfer: false, informadoPeloClienteEm: null,
  conferencia: "PENDENTE", conferidaEm: null, conferidaPor: null, linkGerado: false, alertas: ["Ponto a definir", "Pagar no embarque"],
};

describe("Conferência de embarque", () => {
  it("mostra os dados principais e confirma o ponto escolhido", async () => {
    expect(resumoCategorias({ ADULTO: 2, INFANTIL: 1 })).toBe("2 A · 1 C");
    const api = simularApi({
      "GET /api/conferencia": [item],
      "GET /api/passeios/p1/pontos": [{ id: "pt1", passeioId: "p1", ordem: 50, horario: "08:00", nome: "Villa Romana Shopping", endereco: null, ehTransfer: false, ativo: true }],
      "POST /api/reservas/r1/conferir": { ok: true },
    });
    renderizar(<Conferencia />, { sessao: sessaoFicticia("ATENDENTE", ["reservas:editar", "manifesto:ver"], { unidades: [FLN] }) });
    expect(await screen.findByText("Titular Fictício")).toBeInTheDocument();
    expect(screen.getAllByText("Pagar no embarque").length).toBeGreaterThan(0);
    expect(screen.getByText("Hotel Fictício")).toBeInTheDocument();
    const u = userEvent.setup();
    await u.selectOptions(await screen.findByLabelText(/Ponto de embarque de Titular/), "pt1");
    await u.click(screen.getByRole("button", { name: "Confirmar embarque" }));
    expect(corpoEnviado(api, "POST", "/api/reservas/r1/conferir")).toEqual({ pontoEmbarqueId: "pt1" });
  });
});

describe("Fechamento e mensagens", () => {
  it("avisa do modo simulado e fecha a lista mostrando o texto", async () => {
    const api = simularApi({
      "GET /api/fechamento": { data: "2099-01-05", horaFechamento: "21:00", automatico: true, whatsapp: { provedor: "simulado", envioReal: false, grupoConfigurado: false },
        saidas: [{ saidaId: "s1", passeio: "City Tour Toda Ilha", data: "2099-01-05", guia: "Guia Fictícia Ana", motorista: null, veiculo: null, listaFechadaEm: null, versao: 0, reservas: 4, naoConferidas: 1, semPonto: 1, depoisDoFechamento: 0, mensagens: {} }] },
      "POST /api/saidas/s1/fechar": { versao: 1, texto: "*RELAÇÃO DE PASSAGEIROS*\n01. Fulano Fictício · A", resumo: {} },
    });
    renderizar(<Fechamento />, { sessao: sessaoFicticia("SUPERVISOR", ["saidas:decidir", "manifesto:ver"], { unidades: [FLN] }) });
    expect(await screen.findByText("WhatsApp em modo simulado")).toBeInTheDocument();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Fechar lista agora" }));
    // Pede confirmação antes (fecha a lista e dispara as confirmações).
    expect(api.mock.calls.some(([x]) => String(x) === "/api/saidas/s1/fechar")).toBe(false);
    await u.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Fechar lista" }));
    expect((await screen.findByLabelText("Texto da lista") as HTMLTextAreaElement).value).toContain("RELAÇÃO DE PASSAGEIROS");
    expect(api.mock.calls.some(([u, i]) => String(u) === "/api/saidas/s1/fechar" && i?.method === "POST")).toBe(true);
  });
});
