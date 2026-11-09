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
  const regras = { ligado: true, contarPor: "RESERVAS", pagasParaConfirmar: 10, totalParaConfirmar: 16, pagasMinimasNoTotal: 8, horaPrevia: "09:00", horaLimite: "18:00" };
  const situacao = { data: "2099-01-05", horaFechamento: "21:00", automatico: true, whatsapp: { provedor: "simulado", envioReal: false, grupoConfigurado: false }, regrasConfirmacao: regras,
    saidas: [{ saidaId: "s1", passeio: "City Tour Toda Ilha", data: "2099-01-05", guia: "Guia Fictícia Ana", motorista: null, veiculo: null, listaFechadaEm: null, versao: 0, reservas: 4, naoConferidas: 1, semPonto: 1, depoisDoFechamento: 0,
      confirmacao: { pagas: 3, pendentes: 1, decisao: "AGUARDAR", motivo: "3 pagas e 1 pendentes. Reavaliando até as 18:00.", confirmadaEm: null, automatica: null }, previasEnviadas: 4, viatorSemResposta: 1, mensagens: {} }] };

  it("mostra a confirmação da véspera, confirma a saída e ajusta os pontos de corte", async () => {
    const api = simularApi({
      "GET /api/fechamento": situacao,
      "POST /api/saidas/s1/confirmar": { jaEstava: false, enviadas: 4 },
      "PUT /api/confirmacao/regras": regras,
    });
    renderizar(<Fechamento />, { sessao: sessaoFicticia("SUPERVISOR", ["saidas:decidir", "manifesto:ver"], { unidades: [FLN] }) });
    expect(await screen.findByText("Aguardando")).toBeInTheDocument();
    expect(screen.getByText("3 pagas · 1 pendentes")).toBeInTheDocument();
    expect(screen.getByText("4 prévia(s) enviada(s)")).toBeInTheDocument();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Confirmar saída" }));
    await u.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar saída" }));
    expect(api.mock.calls.some(([x, i]) => String(x) === "/api/saidas/s1/confirmar" && i?.method === "POST")).toBe(true);
    await u.click(screen.getByRole("button", { name: "Ajustar" }));
    const d = within(screen.getByRole("dialog"));
    await u.clear(d.getByLabelText(/Corte 1/));
    await u.type(d.getByLabelText(/Corte 1/), "12");
    await u.click(d.getByRole("button", { name: "Salvar regras" }));
    const put = api.mock.calls.find(([x, i]) => String(x) === "/api/confirmacao/regras" && i?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ pagasParaConfirmar: 12 });
  });

  it("Viator sem resposta: mostra o aviso e o texto pronto para colar no chat da Viator", async () => {
    simularApi({
      "GET /api/fechamento": situacao,
      "GET /api/saidas/s1/viator-sem-resposta": [{ reservaId: "r9", titular: "John Fictício", referencia: "BR-000111222", desde: "2099-01-04T12:00:00Z", idioma: "en", texto: "Hi John! This is By Bus Turismo… name and address of your hotel" }],
    });
    renderizar(<Fechamento />, { sessao: sessaoFicticia("SUPERVISOR", ["saidas:decidir", "manifesto:ver"], { unidades: [FLN] }) });
    expect(await screen.findByText("Viator sem resposta")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Mensagem para a Viator" }));
    const d = within(await screen.findByRole("dialog"));
    expect(await d.findByText(/BR-000111222/)).toBeInTheDocument();
    expect((d.getByLabelText("Texto para John Fictício") as HTMLTextAreaElement).value).toContain("name and address of your hotel");
  });

  it("quem só vê a lista não confirma nem ajusta", async () => {
    simularApi({ "GET /api/fechamento": situacao });
    renderizar(<Fechamento />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver"], { unidades: [FLN] }) });
    expect(await screen.findByText("Aguardando")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar saída" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ajustar" })).toBeNull();
  });

  it("avisa do modo simulado e fecha a lista mostrando o texto", async () => {
    const api = simularApi({
      "GET /api/fechamento": situacao,
      "POST /api/saidas/s1/fechar": { versao: 1, texto: "*RELAÇÃO DE PASSAGEIROS*\n01. Fulano Fictício · A", resumo: {} },
    });
    renderizar(<Fechamento />, { sessao: sessaoFicticia("SUPERVISOR", ["saidas:decidir", "manifesto:ver"], { unidades: [FLN] }) });
    expect(await screen.findByText(/modo simulado/)).toBeInTheDocument();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: "Fechar lista agora" }));
    // Pede confirmação antes (fecha a lista e dispara as confirmações).
    expect(api.mock.calls.some(([x]) => String(x) === "/api/saidas/s1/fechar")).toBe(false);
    await u.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Fechar lista" }));
    expect((await screen.findByLabelText("Texto da lista") as HTMLTextAreaElement).value).toContain("RELAÇÃO DE PASSAGEIROS");
    expect(api.mock.calls.some(([u, i]) => String(u) === "/api/saidas/s1/fechar" && i?.method === "POST")).toBe(true);
  });
});
