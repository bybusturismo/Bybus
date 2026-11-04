import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { AbastecimentoPagina } from "./Abastecimento";
import { ChecklistPagina } from "./Checklist";
import { DocumentosPagina } from "./Documentos";
import { PainelFrotaPagina } from "./Painel";
import type { PainelFrota, Veiculo } from "./tipos";
import { VeiculosPagina } from "./Veiculos";

const veiculo = (extra: Partial<Veiculo> = {}): Veiculo => ({
  id: "v1", unidadeId: FLN.id, unidadeNome: "Florianópolis", placa: "ABC1D23", apelido: "Amarelo", tipo: "ONIBUS_DOIS_ANDARES", modelo: null, ano: 2012, capacidade: 73,
  chassi: null, renavam: null, linhaPrincipal: "City Tour Toda Ilha", usoPublicitario: false, situacao: "ATIVO", kmAtual: 120_000, observacoes: null,
  disponivel: true, motivosBloqueio: [], documentosVencidos: 0, documentosAVencer: 0, manutencoesPendentes: 0, ...extra,
});

const painel: PainelFrota = {
  mes: "2026-11",
  disponibilidade: { total: 5, disponiveis: 4, percentual: 80, indisponiveis: [{ veiculoId: "v2", placa: "XYZ9K88", apelido: "Verde", motivos: ["Documento vencido: Seguro"] }] },
  vencimentos: [{ veiculoId: "v2", placa: "XYZ9K88", apelido: "Verde", documentoId: "d1", tipo: "SEGURO", descricao: null, vencimento: "2026-11-01", situacao: "VENCIDO", dias: -3 }],
  vencimentosTotais: { vencidos: 1, aVencer: 2 },
  manutencoes: [{ veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo", planoId: "p1", nome: "Troca de óleo", critico: true, situacao: "PROXIMA", kmRestante: 800, diasRestantes: null }],
  ordensAbertas: 1,
  checklist: { pendentesHoje: [{ veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo" }], reprovadosHoje: 0 },
  custos: [{ veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo", manutencaoCentavos: 123_456, combustivelCentavos: 50_000, totalCentavos: 173_456, kmRodados: 1000, custoPorKmCentavos: 173 }],
  totais: { manutencaoCentavos: 123_456, combustivelCentavos: 50_000, litros: 400, mediaKml: 2.4 },
  alertasConsumo: [],
};

const ver = sessaoFicticia("SUPERVISOR", ["frota:ver"], { unidades: [FLN] });
const gerenciar = sessaoFicticia("ADMIN", ["frota:ver", "frota:gerenciar"], { unidades: [FLN] });

describe("Painel da frota", () => {
  it("mostra disponibilidade, vencimentos, manutenções e custo por veículo", async () => {
    simularApi({ "GET /api/frota/painel": painel });
    renderizar(<PainelFrotaPagina />, { sessao: ver });
    expect(await screen.findByText("80%")).toBeInTheDocument();
    expect(screen.getByText("4 de 5 veículos")).toBeInTheDocument();
    expect(screen.getByText("Documento vencido: Seguro")).toBeInTheDocument();
    expect(screen.getByText("Vencido há 3 dias")).toBeInTheDocument();
    expect(screen.getByText(/faltam 800 km/)).toBeInTheDocument();
    const linha = screen.getByRole("row", { name: /ABC1D23 — Amarelo/ });
    expect(within(linha).getByText("R$ 1.734,56")).toBeInTheDocument();
    expect(within(linha).getByText("R$ 1,73")).toBeInTheDocument();
  });
});

describe("Veículos", () => {
  it("quem só consulta não vê botões de edição; bloqueio aparece com o motivo", async () => {
    simularApi({ "GET /api/frota/veiculos": [veiculo({ disponivel: false, motivosBloqueio: ["Documento vencido: CRLV"] })] });
    renderizar(<VeiculosPagina />, { sessao: ver });
    expect(await screen.findByText("Documento vencido: CRLV")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Novo veículo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
  });

  it("cadastra veículo validando a placa", async () => {
    const api = simularApi({ "GET /api/frota/veiculos": [], "POST /api/frota/veiculos": veiculo() });
    renderizar(<VeiculosPagina />, { sessao: gerenciar });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: /Novo veículo/ }));
    await u.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Informe a placa/)).toBeInTheDocument();
    await u.type(screen.getByLabelText("Placa"), "abc1d23");
    await u.type(screen.getByLabelText("Capacidade (lugares)"), "73");
    await u.selectOptions(screen.getByLabelText("Tipo"), "ONIBUS_DOIS_ANDARES");
    await u.click(screen.getByRole("button", { name: "Salvar" }));
    expect(corpoEnviado(api, "POST", "/api/frota/veiculos")).toMatchObject({ unidadeId: FLN.id, placa: "ABC1D23", tipo: "ONIBUS_DOIS_ANDARES", capacidade: 73, kmAtual: 0 });
  });
});

describe("Documentos", () => {
  it("alerta de vencido e a vencer; lança documento novo", async () => {
    const api = simularApi({
      "GET /api/frota/veiculos": [veiculo()],
      "GET /api/frota/documentos": [
        { id: "d1", veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo", tipo: "CRLV", descricao: null, numero: null, vencimento: "2026-11-01", observacao: null, situacao: "VENCIDO", dias: -3 },
        { id: "d2", veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo", tipo: "SEGURO", descricao: "Apólice fictícia", numero: null, vencimento: "2026-11-20", observacao: null, situacao: "A_VENCER", dias: 16 },
      ],
      "POST /api/frota/documentos": { id: "d3" },
    });
    renderizar(<DocumentosPagina />, { sessao: gerenciar });
    expect(await screen.findByText("Vencido há 3 dias")).toBeInTheDocument();
    expect(screen.getByText("Vence em 16 dias")).toBeInTheDocument();
    expect(screen.getByText(/bloqueados para escala/)).toBeInTheDocument();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: /Novo documento/ }));
    await u.selectOptions(screen.getByLabelText("Tipo"), "LICENCA_MUNICIPAL");
    await u.type(screen.getByLabelText("Vencimento"), "2027-03-15");
    await u.click(screen.getByRole("button", { name: "Salvar" }));
    expect(corpoEnviado(api, "POST", "/api/frota/documentos")).toMatchObject({ veiculoId: "v1", tipo: "LICENCA_MUNICIPAL", vencimento: "2027-03-15" });
  });
});

describe("Abastecimento", () => {
  it("mostra km/l e o alerta de consumo fora da média", async () => {
    simularApi({
      "GET /api/frota/veiculos": [veiculo()],
      "GET /api/frota/abastecimentos": {
        itens: [{ id: "a1", veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo", data: "2026-11-02", km: 1900, litros: 100, valorCentavos: 60_000, posto: "Posto Fictício", tanqueCheio: true, kml: 1.5, alerta: "ALTO" }],
        resumo: [{ veiculoId: "v1", placa: "ABC1D23", apelido: "Amarelo", litros: 500, valorCentavos: 300_000, mediaKml: 2.3, alertas: 1 }],
      },
    });
    renderizar(<AbastecimentoPagina />, { sessao: ver });
    expect(await screen.findByText("Gasto alto")).toBeInTheDocument();
    expect(screen.getByText("1 fora da média")).toBeInTheDocument();
    expect(screen.getByText("Posto Fictício")).toBeInTheDocument();
  });
});

describe("Checklist do motorista", () => {
  const itens = [
    { id: "i1", grupo: "Mecânica", descricao: "Freios", critico: true, ordem: 10, ativo: true },
    { id: "i2", grupo: "Interior", descricao: "Limpeza", critico: false, ordem: 20, ativo: true },
  ];
  const veiculos = [{ id: "v1", placa: "ABC1D23", apelido: "Amarelo", tipo: "ONIBUS", kmAtual: 1000, situacao: "ATIVO", feitoHoje: false, aprovadoHoje: null }];

  it("exige responder tudo e descrever o problema; envia e avisa o bloqueio", async () => {
    const api = simularApi({
      "GET /api/frota/checklist/veiculos": veiculos,
      "GET /api/frota/checklist/itens": itens,
      "POST /api/frota/checklists": { id: "c1", aprovado: false, veiculoBloqueado: true, resumo: { total: 2, naoOk: 1, criticosNaoOk: 1 }, ordemId: "o1" },
    });
    renderizar(<ChecklistPagina />, { sessao: sessaoFicticia("MOTORISTA", ["frota:checklist"], { unidades: [FLN] }) });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: /ABC1D23/ }));
    await u.click(screen.getByRole("button", { name: /Enviar checklist \(0\/2\)/ }));
    expect(await screen.findByText(/faltam 2/)).toBeInTheDocument();

    const freios = screen.getByRole("group", { name: "Freios" });
    await u.click(within(freios).getByRole("button", { name: "Problema" }));
    await u.click(within(screen.getByRole("group", { name: "Limpeza" })).getByRole("button", { name: "OK" }));
    await u.click(screen.getByRole("button", { name: /Enviar checklist \(2\/2\)/ }));
    expect(await screen.findByText(/Descreva o problema do item “Freios”/)).toBeInTheDocument();

    await u.type(screen.getByLabelText(/O que aconteceu\?/), "Pedal baixo");
    await u.type(screen.getByLabelText(/Km do hodômetro/), "1.050");
    await u.click(screen.getByRole("button", { name: /Enviar checklist/ }));
    expect(corpoEnviado(api, "POST", "/api/frota/checklists")).toMatchObject({
      veiculoId: "v1", km: 1050,
      respostas: [{ itemId: "i1", ok: false, observacao: "Pedal baixo" }, { itemId: "i2", ok: true, observacao: null }],
    });
    expect(await screen.findByText("ABC1D23 bloqueado")).toBeInTheDocument();
  });

  it("motorista só com checklist não vê histórico nem itens", async () => {
    simularApi({ "GET /api/frota/checklist/veiculos": veiculos, "GET /api/frota/checklist/itens": itens });
    renderizar(<ChecklistPagina />, { sessao: sessaoFicticia("MOTORISTA", ["frota:checklist"], { unidades: [FLN] }) });
    await screen.findByRole("button", { name: /ABC1D23/ });
    expect(screen.queryByRole("tab", { name: "Histórico" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Itens/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Veículos" })).not.toBeInTheDocument();
  });
});
