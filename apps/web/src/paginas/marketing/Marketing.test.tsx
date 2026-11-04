import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { Afiliados, codigoSugerido } from "./Afiliados";
import { Campanhas } from "./Campanhas";
import { Canais } from "./Canais";
import { Origem } from "./Origem";

const ver = sessaoFicticia("MKT", ["marketing:ver"]);
const gerenciar = sessaoFicticia("MKT", ["marketing:ver", "marketing:gerenciar"]);

describe("Vendas por canal", () => {
  it("mostra os totais, o canal real e a participação", async () => {
    simularApi({
      "GET /api/marketing/painel/canais": {
        periodo: { de: "2026-08-07", ate: "2026-11-04" },
        total: { reservas: 12, passageiros: 30 },
        porCanal: [{ canal: "PAYTOUR", reservas: 8, passageiros: 20, percentual: 67 }, { canal: "VIATOR", reservas: 4, passageiros: 10, percentual: 33 }],
        porPasseioMes: [{ mes: "2026-10", passeioId: "p", passeio: "City Tour Toda Ilha", reservas: 12, passageiros: 30 }],
      },
    });
    renderizar(<Canais />, { sessao: ver });
    expect(await screen.findByText("Paytour")).toBeInTheDocument();
    expect(screen.getByText("Viator")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("Out. de 2026")).toBeInTheDocument();
    expect(screen.getByText("City Tour Toda Ilha")).toBeInTheDocument();
  });

  it("avisa quando não há vendas", async () => {
    simularApi({ "GET /api/marketing/painel/canais": { periodo: {}, total: { reservas: 0, passageiros: 0 }, porCanal: [], porPasseioMes: [] } });
    renderizar(<Canais />, { sessao: ver });
    expect(await screen.findByText("Nenhuma venda no período.")).toBeInTheDocument();
  });
});

describe("Origem dos clientes", () => {
  it("lista o ranking e destaca o que está sem origem", async () => {
    simularApi({ "GET /api/marketing/painel/origem": { ranking: [{ origem: "SP", reservas: 5, passageiros: 12, percentual: 60 }, { origem: "EUA", reservas: 3, passageiros: 8, percentual: 40 }], outras: 0, semInformacao: { reservas: 2, passageiros: 5 }, totalInformado: 20 } });
    renderizar(<Origem />, { sessao: ver });
    const linhas = await screen.findAllByRole("row");
    expect(within(linhas[1]!).getByText("SP")).toBeInTheDocument();
    expect(screen.getByText(/Reservas sem origem não entram no ranking/)).toBeInTheDocument();
  });
});

const campanha = {
  id: "c1", unidadeId: null, nome: "Google Ads (exemplo)", midia: "GOOGLE_ADS", inicio: "2026-11-01", fim: null, investimentoCentavos: 100000, cupom: "GADS10", utmCampanha: null, metaReservas: 40, observacoes: null, ativa: true,
  resultados: [], totais: { reservas: 0, passageiros: 0, receitaCentavos: null },
  indicadores: { temAtribuicao: false, custoPorReservaCentavos: null, custoPorPassageiroCentavos: null, retorno: null, atingimentoMeta: null },
};

describe("Campanhas", () => {
  it("avisa que a atribuição está a confirmar e mostra 'sem atribuição'", async () => {
    simularApi({ "GET /api/marketing/campanhas": { atribuicao: { situacao: "A_CONFIRMAR", nota: "Atribuição de vendas por cupom/UTM a confirmar com a Paytour." }, campanhas: [campanha], totais: { investimentoCentavos: 100000, reservasAtribuidas: 0 } } });
    renderizar(<Campanhas />, { sessao: ver });
    expect(await screen.findByText("Google Ads (exemplo)")).toBeInTheDocument();
    expect(screen.getByText(/a confirmar com a Paytour/)).toBeInTheDocument();
    expect(screen.getByText("sem atribuição")).toBeInTheDocument();
    expect(screen.getAllByText(/1\.000,00/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Nova campanha/ })).toBeNull();
  });

  it("cria campanha com investimento em centavos", async () => {
    const api = simularApi({
      "GET /api/marketing/campanhas": { atribuicao: { situacao: "A_CONFIRMAR", nota: "x" }, campanhas: [], totais: { investimentoCentavos: 0, reservasAtribuidas: 0 } },
      "POST /api/marketing/campanhas": { id: "novo" },
    });
    renderizar(<Campanhas />, { sessao: { ...gerenciar, usuario: { ...gerenciar.usuario!, todasUnidades: true } } });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: /Nova campanha/ }));
    await u.type(screen.getByLabelText("Nome"), "Cartaz no quiosque");
    await u.type(screen.getByLabelText("Início"), "2026-11-10");
    await u.clear(screen.getByLabelText("Investimento (R$)"));
    await u.type(screen.getByLabelText("Investimento (R$)"), "1.234,56");
    await u.click(screen.getByRole("button", { name: "Criar campanha" }));
    expect(corpoEnviado(api, "POST", "/api/marketing/campanhas")).toMatchObject({ nome: "Cartaz no quiosque", inicio: "2026-11-10", investimentoCentavos: 123456, midia: "GOOGLE_ADS", unidadeId: null });
  });
});

describe("Afiliados", () => {
  it("sugere o código a partir do nome", () => {
    expect(codigoSugerido("Hotel Praia Azul & Spa")).toBe("HOTEL-PRAIA-AZUL-SPA");
  });

  it("lista afiliados, avisa da ligação pendente e abre o QR code", async () => {
    simularApi({
      "GET /api/marketing/afiliados": {
        urlLoja: "https://loja.exemplo.test",
        ligacaoPaytour: { situacao: "PENDENTE", nota: "Ligação com os afiliados da Paytour pendente." },
        afiliados: [{ id: "a1", unidadeId: null, nome: "Hotel Fictício Mar", tipo: "HOTEL", codigo: "HOTEL-MAR", comissaoPontosBase: null, contato: null, paytourAfiliadoId: null, observacoes: null, ativo: true, link: "https://loja.exemplo.test/?ref=HOTEL-MAR" }],
      },
    });
    renderizar(<Afiliados />, { sessao: ver });
    expect(await screen.findByText("Hotel Fictício Mar")).toBeInTheDocument();
    expect(screen.getByText(/Ligação com os afiliados da Paytour pendente/)).toBeInTheDocument();
    expect(screen.getByText("a confirmar")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "QR code" }));
    expect(await screen.findByAltText(/QR code do afiliado Hotel Fictício Mar/)).toBeInTheDocument();
  });
});
