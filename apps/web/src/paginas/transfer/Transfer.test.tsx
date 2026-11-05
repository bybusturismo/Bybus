import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BlocoPassageiros } from "../saida/ListaPassageiros";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { MotoristaTransfer } from "./MotoristaTransfer";
import { Transfer } from "./Transfer";
import type { ParadaTransfer, RespostaTransfer } from "./tipos";

const parada = (id: string, extra: Partial<ParadaTransfer> = {}): ParadaTransfer => ({
  id, reservaId: `r-${id}`, titular: `Titular ${id} Fictício`, pax: 2, assentos: 2, telefone: null, bairroId: "b1", bairro: "Ingleses", endereco: `Hotel ${id} Fictício`, horario: "06:40", horarioManual: false,
  ordem: 0, situacao: "CONFIRMADO", taxaCentavos: 8000, taxaForma: null, taxaSituacao: "A_RECEBER", recebidoPor: null, recebidoEm: null, observacoes: null, ...extra,
});
const totais = { reservas: 3, pax: 6, assentos: 6, buscados: 0, naoApareceram: 0, taxa: { total: 24000, aReceber: 16000, recebidoPix: 8000, recebidoDinheiro: 0, incluidoNoPasseio: 0, naoApareceram: 0 } };
const resposta = (extra: Partial<RespostaTransfer> = {}): RespostaTransfer => ({
  data: "2099-01-02", habilitado: true,
  saida: { id: "s1", data: "2099-01-02", status: "PREVISTA", passeioId: "p1", passeio: "City Tour Toda Ilha", unidadeId: FLN.id, listaFechadaEm: null },
  config: { taxaPorPassageiroCentavos: 4000, taxaAConfirmar: true, intervaloMinutos: 5 },
  dia: { id: "d1", veiculoId: null, veiculoTexto: "Van fictícia", veiculo: "Van fictícia", veiculoCapacidade: null, motoristaId: "m1", motorista: "Motorista Fictício Davi", lugares: 15, pontoEncontroId: "pt1", chegadaPrevista: null, observacoes: null },
  encontro: { id: "pt1", nome: "Villa Romana Shopping", horario: "08:00" },
  pontosEncontro: [{ id: "pt1", nome: "Villa Romana Shopping", horario: "08:00" }], bairros: [{ id: "b1", nome: "Ingleses", ordemBusca: 2, horarioReferencia: "06:40" }],
  reservas: [parada("a", { ordem: 0 }), parada("b", { ordem: 1, bairro: "Canasvieiras", horario: "07:00", taxaSituacao: "RECEBIDO", taxaForma: "PIX", recebidoPor: "Motorista Fictício Davi" }), parada("c", { ordem: 2, bairro: "Jurerê", horario: "07:10", taxaCentavos: 8000 })],
  candidatas: 0, totais, alertas: [], opcoes: { motoristas: [{ id: "m1", nome: "Motorista Fictício Davi" }], veiculos: [] },
  ...extra,
});
const sessaoGestao = sessaoFicticia("SUPERVISOR", ["manifesto:ver", "transfer:gerenciar", "manifesto:contatos"]);

describe("Transfer (gestão)", () => {
  it("mostra o quadro, as paradas em ordem de busca e os totais da taxa", async () => {
    simularApi({ "GET /api/transfer/passeios": [{ id: "p1", nome: "City Tour Toda Ilha", unidadeId: FLN.id }], "GET /api/transfer": resposta() });
    renderizar(<Transfer />, { sessao: sessaoGestao });
    expect(await screen.findByText("Villa Romana Shopping às 08:00")).toBeInTheDocument();
    expect(screen.getByText("6 passageiro(s) de 15 lugares")).toBeInTheDocument();
    const linhas = screen.getAllByRole("row").slice(1);
    expect(linhas).toHaveLength(3);
    expect(within(linhas[0]!).getByText("Titular a Fictício")).toBeInTheDocument();
    expect(within(linhas[1]!).getByText(/recebida \(PIX\) por Motorista Fictício Davi/)).toBeInTheDocument();
    const totaisTaxa = screen.getByRole("region", { name: "Totais da taxa" });
    expect(within(totaisTaxa).getByText("R$ 160,00")).toBeInTheDocument(); // a receber
    expect(within(totaisTaxa).getByText(/R\$ 40,00 \(a confirmar\)/)).toBeInTheDocument();
  });

  it("subir e descer chamam a API com a nova posição", async () => {
    const api = simularApi({ "GET /api/transfer/passeios": [{ id: "p1", nome: "City Tour Toda Ilha", unidadeId: FLN.id }], "GET /api/transfer": resposta(), "POST /api/transfer/reservas/b/mover": resposta() });
    renderizar(<Transfer />, { sessao: sessaoGestao });
    await screen.findByText("Titular b Fictício");
    const u = userEvent.setup();
    expect(screen.getByRole("button", { name: "Subir Titular a Fictício" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "Subir Titular b Fictício" }));
    await waitFor(() => expect(corpoEnviado(api, "POST", "/api/transfer/reservas/b/mover")).toEqual({ posicao: 0 }));
    await u.click(screen.getByRole("button", { name: "Descer Titular b Fictício" }));
    await waitFor(() => expect(corpoEnviado(api, "POST", "/api/transfer/reservas/b/mover", 1)).toEqual({ posicao: 2 }));
  });

  it("quem só vê a lista não tem botões de ordem nem de edição", async () => {
    simularApi({ "GET /api/transfer/passeios": [{ id: "p1", nome: "City Tour Toda Ilha", unidadeId: FLN.id }], "GET /api/transfer": resposta({ opcoes: null }) });
    renderizar(<Transfer />, { sessao: sessaoFicticia("GUIA", ["manifesto:ver"]) });
    await screen.findByText("Titular a Fictício");
    expect(screen.queryByRole("button", { name: /Subir/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Recalcular ordem/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Copiar texto/ })).toBeInTheDocument();
  });

  it("sem transfer montado, oferece montar com o número de reservas candidatas", async () => {
    const api = simularApi({
      "GET /api/transfer/passeios": [{ id: "p1", nome: "City Tour Toda Ilha", unidadeId: FLN.id }],
      "GET /api/transfer": resposta({ dia: null, reservas: [], candidatas: 4, totais: undefined }),
      "POST /api/transfer/montar": resposta(),
    });
    renderizar(<Transfer />, { sessao: sessaoGestao });
    expect(await screen.findByText(/4 reserva\(s\) com transfer/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /Montar transfer do dia/ }));
    await waitFor(() => expect(corpoEnviado(api, "POST", "/api/transfer/montar")).toEqual({ saidaId: "s1" }));
    expect(await screen.findByText("Titular a Fictício")).toBeInTheDocument();
  });

  it("copiar texto usa a área de transferência", async () => {
    const u = userEvent.setup(); // o user-event instala a própria área de transferência
    const escrever = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    simularApi({ "GET /api/transfer/passeios": [{ id: "p1", nome: "City Tour Toda Ilha", unidadeId: FLN.id }], "GET /api/transfer": resposta(), "GET /api/transfer/texto": { texto: "*TRANSFER — teste*" } });
    renderizar(<Transfer />, { sessao: sessaoGestao });
    await screen.findByText("Titular a Fictício");
    await u.click(screen.getByRole("button", { name: /Copiar texto/ }));
    await waitFor(() => expect(escrever).toHaveBeenCalledWith("*TRANSFER — teste*"));
  });
});

describe("Meu transfer (motorista)", () => {
  const sessaoMot = sessaoFicticia("MOTORISTA", ["manifesto:ver", "transfer:operar"]);
  const dados = () => ({ hoje: "2099-01-02", amanha: "2099-01-03", transfers: [resposta({ opcoes: null })] });

  it("marca buscado e não apareceu", async () => {
    const api = simularApi({ "GET /api/transfer/motorista": dados(), "POST /api/transfer/reservas/a/situacao": {} });
    renderizar(<MotoristaTransfer />, { sessao: sessaoMot });
    expect(await screen.findByText("Hotel a Fictício")).toBeInTheDocument();
    const u = userEvent.setup();
    const primeira = screen.getAllByRole("listitem")[0]!;
    await u.click(within(primeira).getByRole("button", { name: "Buscado" }));
    await waitFor(() => expect(corpoEnviado(api, "POST", "/api/transfer/reservas/a/situacao")).toEqual({ situacao: "BUSCADO" }));
    await u.click(within(primeira).getByRole("button", { name: "Não apareceu" }));
    await waitFor(() => expect(corpoEnviado(api, "POST", "/api/transfer/reservas/a/situacao", 1)).toEqual({ situacao: "NAO_APARECEU" }));
  });

  it("registra a taxa recebida por PIX ou dinheiro com o valor exato; quem já pagou não mostra os botões", async () => {
    const api = simularApi({ "GET /api/transfer/motorista": dados(), "POST /api/transfer/reservas/a/recebimento": {}, "POST /api/transfer/reservas/c/recebimento": {} });
    renderizar(<MotoristaTransfer />, { sessao: sessaoMot });
    await screen.findByText("Hotel a Fictício");
    const itens = screen.getAllByRole("listitem");
    expect(within(itens[1]!).queryByRole("button", { name: /Recebi/ })).toBeNull(); // b já pagou
    const u = userEvent.setup();
    await u.click(within(itens[0]!).getByRole("button", { name: /Recebi R\$ 80,00 — PIX/ }));
    await waitFor(() => expect(corpoEnviado(api, "POST", "/api/transfer/reservas/a/recebimento")).toEqual({ forma: "PIX", valorCentavos: 8000 }));
    await u.click(within(itens[2]!).getByRole("button", { name: /Recebi R\$ 80,00 — Dinheiro/ }));
    await waitFor(() => expect(corpoEnviado(api, "POST", "/api/transfer/reservas/c/recebimento")).toEqual({ forma: "DINHEIRO", valorCentavos: 8000 }));
  });

  it("mostra o erro da API sem esconder a lista", async () => {
    const fetchSpy = simularApi({ "GET /api/transfer/motorista": dados() });
    renderizar(<MotoristaTransfer />, { sessao: sessaoMot });
    await screen.findByText("Hotel a Fictício");
    await userEvent.setup().click(within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: "Buscado" }));
    expect(await screen.findByText(/Rota não simulada/)).toBeInTheDocument();
    expect(screen.getByText("Hotel a Fictício")).toBeInTheDocument();
    fetchSpy.mockRestore();
  });
});

describe("Lista de passageiros: via transfer", () => {
  it("mostra o ponto de encontro no bloco do transfer e a marca na linha, sem duplicar passageiro", () => {
    const bloco = {
      ponto: { id: "pt", ordem: 10, horario: "06:50", nome: "Transfer — Ingleses", endereco: null, ehTransfer: true },
      linhas: [{ numero: 1, reservaId: "r1", canal: "PAYTOUR", codigoExterno: null, contatoNome: "Ana Fictícia", contatoTelefone: null, observacoes: null, passageiro: { id: "x1", nome: "Ana Fictícia", categoria: "ADULTO", documentoTipo: null, documento: null, documentoValido: null, embarque: "PENDENTE", pontoEmbarqueId: null } }],
    } as never;
    renderizar(<BlocoPassageiros bloco={bloco} filtro="" transfer={{ encontro: { nome: "Villa Romana Shopping", horario: "07:50" }, reservas: { r1: { bairro: "Ingleses" } } }} />);
    expect(screen.getByText(/embarcam todos no ponto de encontro/)).toBeInTheDocument();
    expect(screen.getByText("Villa Romana Shopping às 07:50")).toBeInTheDocument();
    expect(screen.getByText(/via transfer · Ingleses/)).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2); // cabeçalho + um passageiro (a marca não cria outra linha)
  });
});
