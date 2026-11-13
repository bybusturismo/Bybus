import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { GrupoFicha, Grupos } from "./Grupos";
import { ListaGrupoPublica } from "./ListaGrupoPublica";

const sessao = sessaoFicticia("SUPERVISOR", ["reservas:editar"], { unidades: [FLN] });
const detalhe = {
  id: "g1", unidadeId: null, nome: "Escola Fictícia", estilo: "ESCOLA", status: "CONFIRMADO", dataPasseio: "2027-03-20", horarioInicio: "08:00", localInicio: null,
  guiaId: null, veiculo: null, roteiro: "Centro\nLagoa", duracaoTexto: null, almoco: true, localAlmoco: "Ingleses", pessoas: 20, pessoasMinimo: 25, cortesias: 3,
  valorPorPessoaCentavos: 13000, valorTotalCentavos: 325000, sinalPercentual: 50, nfEmitida: false, nfNumero: null, razaoSocial: null, cnpj: null, endereco: null,
  representanteNome: "Representante Fictícia", representanteCargo: null, representanteTelefone: null, representanteEmail: null, representanteCpf: null, observacoes: null,
  cobrancas: [{ id: "c1", descricao: "Escola Fictícia — Sinal (50%) para reservar a data", valorCentavos: 162500, vencimento: "2027-02-20", situacao: "REALIZADO", pagoEm: "2027-02-19", valorPagoCentavos: 162500 }],
  anexos: [{ id: "a1", tipo: "CONTRATO", nomeArquivo: "contrato.pdf", tamanho: 100, criadoEm: "2026-11-13T12:00:00Z" }],
  anteriores: [{ id: "g0", dataPasseio: "2026-03-21", status: "REALIZADO", pessoas: 28, valorPorPessoaCentavos: 12000, valorTotalCentavos: 336000, roteiro: "Centro" }],
};

describe("Grupos fechados (13/11/2026)", () => {
  it("lista com recebido e o que falta", async () => {
    simularApi({ "GET /api/grupos": [{ id: "g1", nome: "Escola Fictícia", estilo: "ESCOLA", status: "CONFIRMADO", dataPasseio: "2027-03-20", pessoas: 20, valorPorPessoaCentavos: 13000, valorTotalCentavos: 325000, representanteNome: "Representante Fictícia", representanteTelefone: null, nfEmitida: false, unidadeId: null, guia: null, cobradoCentavos: 325000, recebidoCentavos: 162500 }] });
    renderizar(<Grupos />, { sessao });
    const linha = await screen.findByRole("row", { name: /Escola Fictícia/ });
    expect(linha).toHaveTextContent("falta R$ 1.625,00");
  });

  it("ficha: pagamentos do financeiro, anexo do contrato e histórico de anos anteriores", async () => {
    simularApi({ "GET /api/grupos/g1": detalhe, "GET /api/pessoas": [], "GET /api/grupos/g1/passageiros": { passageiros: [], totais: {}, link: { ativo: false, expiraEm: null, atualizadaEm: null } } });
    renderizar(<Routes><Route path="/grupos/:id" element={<GrupoFicha />} /></Routes>, { sessao, rota: "/grupos/g1" });
    expect(await screen.findByRole("heading", { name: "Escola Fictícia" })).toBeInTheDocument();
    const pag = within(screen.getByRole("region", { name: "Pagamentos" }));
    expect(pag.getByRole("row", { name: /Sinal \(50%\)/ })).toHaveTextContent("Pago em 19/02/2027");
    expect(screen.getByRole("link", { name: /Contrato — contrato.pdf/ })).toHaveAttribute("href", "/api/grupos/anexos/a1");
    expect(screen.getByRole("link", { name: /Contrato \(PDF\)/ })).toHaveAttribute("href", "/api/grupos/g1/contrato.pdf");
    expect(pag.getByRole("link", { name: "Recibo" })).toHaveAttribute("href", "/api/grupos/g1/recibo/c1");
    expect(within(screen.getByRole("region", { name: "Histórico deste grupo" })).getByRole("row", { name: /21\/03\/2026/ })).toHaveTextContent("R$ 120,00");
  });

  it("novo grupo envia valores em centavos e o CPF", async () => {
    const spy = simularApi({ "GET /api/pessoas": [], "POST /api/grupos": { id: "g9" }, "GET /api/grupos/g9": { ...detalhe, id: "g9", cobrancas: [], anexos: [], anteriores: [] }, "GET /api/grupos/g9/passageiros": { passageiros: [], totais: {}, link: { ativo: false, expiraEm: null, atualizadaEm: null } } });
    renderizar(<Routes><Route path="/grupos/:id" element={<GrupoFicha />} /></Routes>, { sessao, rota: "/grupos/novo" });
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Nome do grupo / instituição"), "Empresa Fictícia");
    await u.type(screen.getByLabelText("Pessoas (pagantes)"), "30");
    await u.type(screen.getByLabelText("Valor por pessoa (R$)"), "150,00");
    await u.type(screen.getByLabelText("CPF do representante"), "000.000.000-00");
    await u.click(screen.getByLabelText("Houve parada para almoço"));
    await u.type(screen.getByLabelText("Onde foi o almoço"), "Restaurante fictício");
    await u.click(screen.getByRole("button", { name: "Cadastrar grupo" }));
    await screen.findByText("Grupo cadastrado.");
    expect(corpoEnviado(spy, "POST", "/api/grupos")).toMatchObject({ nome: "Empresa Fictícia", pessoas: 30, valorPorPessoaCentavos: 15000, representanteCpf: "000.000.000-00", almoco: true, localAlmoco: "Restaurante fictício" });
  });
});

describe("Lista de passageiros do grupo (13/11/2026)", () => {
  it("representante importa CSV, precisa do aceite e envia a lista", async () => {
    const tok = "tokenFicticioLista0123456789ab";
    const spy = simularApi({
      [`GET /api/publico/lista-grupo/${tok}`]: { grupo: { nome: "Escola Fictícia", estilo: "ESCOLA", dataPasseio: "2099-05-10", horarioInicio: "08:00", localInicio: null }, aberta: true, passageiros: [], atualizadaEm: null },
      [`PUT /api/publico/lista-grupo/${tok}`]: { quantidade: 2 },
    });
    renderizar(<ListaGrupoPublica token={tok} />);
    expect(await screen.findByText(/Escola Fictícia/)).toBeInTheDocument();
    const u = userEvent.setup();
    const csv = new File(["Nome;Documento;Função\nAluno Fictício Um;529.982.247-25;aluno\nProfessora Fictícia;1234567;professora\n"], "lista.csv", { type: "text/csv" });
    await u.upload(screen.getByLabelText(/Importar planilha/), csv);
    expect(await screen.findByText(/2 pessoa\(s\) importada\(s\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Nome da linha 1")).toHaveValue("Aluno Fictício Um");
    await u.click(screen.getByRole("button", { name: "Enviar lista" }));
    expect(await screen.findByText(/Marque a confirmação de autorização/)).toBeInTheDocument();
    await u.click(screen.getByLabelText(/Declaro ter autorização/));
    await u.click(screen.getByRole("button", { name: "Enviar lista" }));
    expect(await screen.findByText(/Lista enviada: 2 pessoa/)).toBeInTheDocument();
    const corpo = corpoEnviado(spy, "PUT", `/api/publico/lista-grupo/${tok}`) as { aceite: boolean; passageiros: Array<{ nome: string; categoria: string }> };
    expect(corpo.aceite).toBe(true);
    expect(corpo.passageiros.map((p) => [p.nome, p.categoria])).toEqual([["Aluno Fictício Um", "ALUNO"], ["Professora Fictícia", "PROFESSOR"]]);
  });
});
