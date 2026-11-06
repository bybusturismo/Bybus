import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { VisaoGeral } from "./VisaoGeral";
import { ListaDeReservas } from "./ListaReservas";

const periodo = { de: "2026-10-06", ate: "2026-11-04" };
const resumo = (valores: boolean) => ({
  hoje: "2026-11-04",
  faturamentoMes: { mes: "2026-11", reservas: 12, semValor: 1, valorCentavos: valores ? 123456 : null, mesAnteriorCentavos: valores ? 100000 : null },
  cupons: { usos: 2, descontoCentavos: valores ? 3000 : null, porCupom: [{ cupomId: "415", usos: 2, descontoCentavos: valores ? 3000 : null }] },
  pendencias: { aConferir: 5, semPonto: 3, aPagarNoEmbarque: 2, formularioPendente: 1 },
  saidasHoje: [{ id: "s1", passeio: "City Tour Toda Ilha", status: "CONFIRMADA", capacidade: 40, vendidos: 30, ocupacao: 75, veiculo: null, guia: "Guia Fictícia Ana", motorista: null, checkinsPendentes: 4 }],
  aguardandoPagamento: { pedidos: 2, saldoCentavos: valores ? 8000 : null },
  comissaoAfiliados: { pedidos: 1, totalCentavos: valores ? 900 : null },
  whatsapp: { disponivel: false, naoLidas: null },
  ota: { naoIntegradas: ["GetYourGuide"] },
});
const analises = {
  "GET /api/passeios": [],
  "GET /api/visao-geral/emissores": { periodo, baseDoPercentual: "reservas", total: { reservas: 4, valorCentavos: null }, emissores: [{ cidade: "Curitiba", uf: "PR", reservas: 4, passageiros: 9, valorCentavos: null, percentual: 100 }] },
  "GET /api/visao-geral/dia-semana": { periodo, dias: Array.from({ length: 7 }, (_, dia) => ({ dia, total: dia === 6 ? 3 : 0, porCanal: dia === 6 ? { SITE: 3 } : {} })), canais: ["SITE"] },
  "GET /api/visao-geral/horario-compra": { periodo, faixas: ["02–06", "06–10", "10–14", "14–18", "18–22", "22–02"].map((rotulo) => ({ rotulo, site: 1, admin: 0, outros: 0 })), nota: "n" },
  "GET /api/visao-geral/passeios": { periodo, baseDoPercentual: "passageiros", total: { reservas: 4, passageiros: 9, valorCentavos: null }, passeios: [{ passeioId: "p1", passeio: "City Tour Toda Ilha", reservas: 4, passageiros: 9, valorCentavos: null, percentual: 100 }] },
  "GET /api/visao-geral/pagamentos": { periodo, baseDoPercentual: "reservas", total: { reservas: 4, valorCentavos: null }, formas: [{ forma: "PIX", reservas: 4, valorCentavos: null, percentual: 100 }] },
};

describe("Visão Geral", () => {
  it("sem financeiro:ver não mostra nenhum valor em R$ nem os blocos só em R$", async () => {
    simularApi({ ...analises, "GET /api/visao-geral/resumo": resumo(false) });
    renderizar(<VisaoGeral />, { sessao: sessaoFicticia("ATENDENTE", ["manifesto:ver", "marketing:ver", "reservas:editar"]) });
    expect(await screen.findByText("Reservas do mês")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/R\$\s*\d/);
    expect(screen.queryByRole("heading", { name: "Vendas por período" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Comparativo/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Maiores emissores (cidade/UF)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Nova reserva/ })).toHaveAttribute("href", "/listas/saidas?acao=nova-reserva");
  });

  it("quem só tem manifesto:ver vê a operação e nenhuma análise de vendas", async () => {
    simularApi({ "GET /api/visao-geral/resumo": resumo(false) });
    renderizar(<VisaoGeral />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver"]) });
    expect(await screen.findByRole("heading", { name: "Saídas de hoje" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Passeios mais vendidos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Nova reserva/ })).not.toBeInTheDocument();
  });

  it("pendências levam à listagem filtrada; saídas de hoje mostram ocupação e equipe", async () => {
    simularApi({ "GET /api/visao-geral/resumo": resumo(false) });
    renderizar(<VisaoGeral />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver"]) });
    const link = await screen.findByRole("link", { name: /Reservas a conferir/ });
    expect(link).toHaveAttribute("href", "/reservas?pendencia=a_conferir");
    expect(screen.getByRole("img", { name: "30 de 40 lugares, 75% de ocupação" })).toBeInTheDocument();
    expect(screen.getByText(/Guia: Guia Fictícia Ana/)).toBeInTheDocument();
  });

  it("com financeiro:ver mostra faturamento e os gráficos têm título e tabela alternativa", async () => {
    simularApi({
      ...analises, "GET /api/visao-geral/resumo": resumo(true),
      "GET /api/visao-geral/faturamento": { periodo, agrupamento: "dia", pontos: [{ chave: "2026-11-03", total: 5000, porCanal: { SITE: 5000 } }], totaisPorCanal: { SITE: 5000 }, totalCentavos: 5000, canais: ["SITE"] },
      "GET /api/visao-geral/comparativo": { periodo, anos: [2026, 2025, 2024].map((ano) => ({ ano, de: "x", ate: "y", reservas: 1, valorCentavos: 1000 * (2027 - ano) })), semHistorico: false },
    });
    renderizar(<VisaoGeral />, { sessao: sessaoFicticia("ADMIN", ["manifesto:ver", "marketing:ver", "financeiro:ver"]) });
    expect(await screen.findByText(/R\$\s*1\.234,56/)).toBeInTheDocument();
    const bloco = (await screen.findByRole("heading", { name: "Vendas por período" })).closest("section")!;
    await waitFor(() => expect(within(bloco).getByRole("img", { name: /Vendas por período e canal/ })).toBeInTheDocument());
    expect(within(bloco).getByText("Ver como tabela")).toBeInTheDocument();
  });
});

describe("Listagem de reservas", () => {
  it("lê os filtros da URL e envia ao servidor; valor só com financeiro:ver", async () => {
    const spy = simularApi({
      "GET /api/passeios": [],
      "GET /api/reservas": { periodo, total: 1, pagina: 1, limite: 50, reservas: [{ id: "r1", saidaId: "s1", data: "2026-11-05", passeio: "City Tour Toda Ilha", passeioId: "p1", canal: "PAYTOUR", codigoExterno: "PAYTOUR-1", contatoNome: "Cliente Fictício", passageiros: 2, status: "CONFIRMADA", conferencia: "PENDENTE", pagamento: "A_PAGAR", formaPagamento: null, pontoEmbarque: null, formularioPendente: false, compraEm: null }] },
    });
    renderizar(<ListaDeReservas />, { sessao: sessaoFicticia("ATENDENTE", ["manifesto:ver"]), rota: "/reservas?pendencia=a_pagar" });
    expect(await screen.findByText("Cliente Fictício")).toBeInTheDocument();
    expect(screen.getByText("Pagar no embarque", { selector: "td" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Valor" })).not.toBeInTheDocument();
    const chamada = spy.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith("/api/reservas"))!;
    expect(chamada).toContain("pendencia=a_pagar");
  });
});
