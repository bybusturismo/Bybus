import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { AbastecimentoPagina } from "./Abastecimento";
import { numeroDeTexto } from "./comum";
import { ChecklistPagina } from "./Checklist";
import { DocumentosPagina } from "./Documentos";
import { ManutencaoPagina } from "./Manutencao";
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

describe("Abastecimento: filtro por coluna (13/11/2026)", () => {
  it("filtra só um veículo, mostra a soma e classifica do maior para o menor valor", async () => {
    const a = (id: string, placa: string, valor: number, data: string) => ({ id, veiculoId: placa, placa, apelido: null, data, km: 1000, litros: 50, valorCentavos: valor, posto: "Posto Fictício", tanqueCheio: true, kml: 2, alerta: null });
    simularApi({
      "GET /api/frota/veiculos": [veiculo()],
      "GET /api/frota/abastecimentos": { itens: [a("1", "ABC1D23", 30_000, "2026-11-01"), a("2", "XYZ9K88", 50_000, "2026-11-02"), a("3", "ABC1D23", 40_000, "2026-11-03")], resumo: [] },
    });
    renderizar(<AbastecimentoPagina />, { sessao: ver });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: /^Veículo/ }));
    const menu = screen.getByRole("dialog", { name: "Filtrar Veículo" });
    await u.click(within(menu).getByLabelText("(Selecionar tudo)"));
    await u.click(within(menu).getByLabelText("XYZ9K88"));
    await u.click(within(menu).getByRole("button", { name: "Aplicar" }));
    expect(screen.getByText("1 de 3 abastecimento(s) no filtro das colunas")).toBeInTheDocument();
    expect(screen.queryAllByRole("row", { name: /ABC1D23/ })).toHaveLength(0);
    await u.click(screen.getByRole("button", { name: /^Veículo/ }));
    await u.click(within(screen.getByRole("dialog", { name: "Filtrar Veículo" })).getByRole("button", { name: "Limpar" }));
    await u.click(screen.getByRole("button", { name: /^Valor/ }));
    await u.click(screen.getByRole("button", { name: "Do maior para o menor" }));
    const linhas = screen.getAllByRole("row").slice(1).map((x) => x.textContent ?? "");
    expect(linhas[0]).toMatch(/500,00/);
    expect(linhas[2]).toMatch(/300,00/);
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

describe("numeroDeTexto", () => {
  it("litros: ponto do celular é decimal, vírgula é decimal, milhar só com vírgula ou grupos de 3", () => {
    expect(numeroDeTexto("45.5", true)).toBe(45.5);
    expect(numeroDeTexto("45,5", true)).toBe(45.5);
    expect(numeroDeTexto("1.234,5", true)).toBe(1234.5);
    expect(numeroDeTexto("1.234.567", true)).toBe(1234567);
    expect(numeroDeTexto("100", true)).toBe(100);
    expect(numeroDeTexto("4.5.5", true)).toBeNaN();
    expect(numeroDeTexto("45,5,5", true)).toBeNaN();
    expect(numeroDeTexto("abc", true)).toBeNaN();
    expect(numeroDeTexto("  ", true)).toBeNull();
  });
  it("inteiros: ponto é milhar e decimal é erro", () => {
    expect(numeroDeTexto("1.500")).toBe(1500);
    expect(numeroDeTexto("120000")).toBe(120000);
    expect(numeroDeTexto("12,5")).toBeNaN();
    expect(numeroDeTexto("12.5")).toBeNaN();
  });
});

describe("Abastecimento: litros digitados com ponto", () => {
  it("45.5 litros vai como 45,5 e não como 455", async () => {
    const api = simularApi({ "GET /api/frota/veiculos": [veiculo()], "GET /api/frota/abastecimentos": { itens: [], resumo: [] }, "POST /api/frota/abastecimentos": { id: "a1", alerta: null } });
    renderizar(<AbastecimentoPagina />, { sessao: gerenciar });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: /Novo abastecimento/ }));
    await u.type(screen.getByLabelText("Km do hodômetro"), "121000");
    await u.type(screen.getByLabelText("Litros"), "45.5");
    await u.type(screen.getByLabelText(/Valor total/), "300,00");
    await u.click(screen.getByRole("button", { name: "Salvar" }));
    expect(corpoEnviado(api, "POST", "/api/frota/abastecimentos")).toMatchObject({ km: 121000, litros: 45.5, valorCentavos: 30000 });
  });
});

describe("Arquivos do Drive do veículo (gabaritos)", () => {
  it("quem só vê a frota abre a lista por pasta, com Abrir e Baixar", async () => {
    simularApi({
      "GET /api/frota/veiculos": [veiculo({ driveLink: "https://drive.google.com/drive/folders/1PastaFicticia0001" })],
      "GET /api/frota/veiculos/v1/drive": { pasta: "Gabaritos fictícios", email: "x@y", itens: [
        { id: "1ArqFrente000001", nome: "frente.pdf", tipo: "application/pdf", tamanho: 2_500_000, modificadoEm: null, caminho: "" },
        { id: "1ArqLado00000002", nome: "lado.png", tipo: "image/png", tamanho: 4000, modificadoEm: null, caminho: "Lateral" },
      ] },
    });
    renderizar(<VeiculosPagina />, { sessao: ver });
    await userEvent.click(await screen.findByRole("button", { name: "Gabaritos e arquivos de ABC1D23" }));
    const janela = await screen.findByRole("dialog", { name: /Arquivos de ABC1D23/ });
    expect(await within(janela).findByText(/Gabaritos fictícios/)).toBeInTheDocument();
    expect(within(janela).getByRole("heading", { name: "Lateral" })).toBeInTheDocument();
    const abrir = within(janela).getAllByRole("link", { name: "Abrir" })[0]!;
    expect(abrir).toHaveAttribute("href", "/api/frota/veiculos/v1/drive/1ArqFrente000001");
    expect(within(janela).getAllByRole("link", { name: /Baixar/ })[1]).toHaveAttribute("href", "/api/frota/veiculos/v1/drive/1ArqLado00000002?baixar=1");
    expect(janela).toHaveTextContent("2,4 MB");
  });
});

describe("Nova ordem de manutenção (13/11/2026)", () => {
  it("descrição longa, valores de peças e serviço, km e anexos; mostra os anexos na lista", async () => {
    const spy = simularApi({
      "GET /api/frota/veiculos": [veiculo()],
      "GET /api/frota/planos": [],
      "GET /api/frota/ordens": [{
        id: "o1", veiculoId: "v1", planoId: null, placa: "ABC1D23", apelido: null, tipo: "CORRETIVA", status: "ABERTA", descricao: "Linha 1\nLinha 2", oficina: null, pecas: null,
        imobiliza: false, abertaEm: "2026-11-10", concluidaEm: null, km: 120_100, kmRevisao: 130_000, valorPecasCentavos: 10_000, valorServicoCentavos: 5_000, custoCentavos: 15_000,
        diasParado: 3, anexos: [{ id: "x1", tipo: "NFSE", nomeArquivo: "nfse.pdf", tamanho: 100 }],
      }],
      "POST /api/frota/ordens": { id: "o2" },
      "POST /api/frota/ordens/o2/anexos": { id: "x2" },
    });
    renderizar(<ManutencaoPagina />, { sessao: gerenciar });
    expect(await screen.findByRole("link", { name: /NFS-e \(serviço\)/ })).toHaveAttribute("href", "/api/frota/anexos/x1");
    expect(screen.getByText(/revisão\/garantia em 130.000 km/)).toBeInTheDocument();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: /Nova ordem/ }));
    const d = within(await screen.findByRole("dialog"));
    const desc = d.getByLabelText("Descrição do serviço");
    expect(desc.tagName).toBe("TEXTAREA");
    expect(desc).toHaveAttribute("rows", "10");
    await u.type(desc, "Troca da embreagem fictícia");
    await u.type(d.getByLabelText("Valor das peças (R$)"), "1.500,00");
    await u.type(d.getByLabelText("Valor do serviço (R$)"), "450,00");
    expect(d.getByText("R$ 1.950,00")).toBeInTheDocument();
    await u.type(d.getByLabelText("KM atual"), "120100");
    await u.type(d.getByLabelText("KM da revisão / garantia"), "130100");
    await u.upload(d.getByLabelText("Ordem de serviço"), new File(["%PDF-1.4"], "os.pdf", { type: "application/pdf" }));
    await u.click(d.getByRole("button", { name: "Abrir ordem" }));
    await screen.findByText("Ordem aberta.");
    expect(corpoEnviado(spy, "POST", "/api/frota/ordens")).toMatchObject({ descricao: "Troca da embreagem fictícia", valorPecasCentavos: 150_000, valorServicoCentavos: 45_000, km: 120_100, kmRevisao: 130_100 });
    expect(corpoEnviado(spy, "POST", "/api/frota/ordens/o2/anexos")).toMatchObject({ tipo: "OS", nome: "os.pdf" });
  });
});
