import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { Lancamentos } from "./Lancamentos";
import type { CategoriaFin, ContaFin, LancamentoFin } from "./tipos";

const cat = (id: string, nome: string, tipo: "RECEITA" | "DESPESA"): CategoriaFin => ({ id, codigo: id, nome, tipo, grupo: "G", ordem: 1, ativa: true, sistema: true });
const categorias = [cat("c-comb", "Combustível", "DESPESA"), cat("c-frete", "Fretamento", "RECEITA")];
const conta: ContaFin = { id: "k1", unidadeId: FLN.id, nome: "Corrente Teste", tipo: "CORRENTE", banco: null, finalConta: null, saldoInicialCentavos: 0, saldoInicialEm: null, diaFechamento: null, diaVencimento: null, contaPagamentoId: null, ativa: true, saldoCentavos: 0, linhasPendentes: 0 };

function lanc(extra: Partial<LancamentoFin> = {}): LancamentoFin {
  return {
    id: "l1", tipo: "PAGAR", descricao: "Combustível outubro", contraparte: "Posto Teste", categoriaId: "c-comb", categoriaNome: "Combustível", contaId: null, contaNome: null, unidadeId: FLN.id, linha: "CITY_TOUR",
    veiculo: "ABC1D23", canal: null, forma: null, valorCentavos: 100000, competencia: "2026-11-01", vencimento: "2026-11-10", situacao: "ABERTO", pagoEm: null, valorPagoCentavos: null,
    jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0, grupoId: null, parcelaNumero: null, parcelaTotal: null, recorrente: false, observacao: null, origem: "MANUAL", conciliado: false, vencido: false, ...extra,
  };
}

function api(itens: LancamentoFin[]) {
  return simularApi({
    "GET /api/financeiro/categorias": categorias,
    "GET /api/financeiro/contas": [conta],
    "GET /api/financeiro/lancamentos": { hoje: "2026-11-04", itens, total: itens.length, somaDevidoCentavos: 0, somaAbertoCentavos: 100000, somaRealizadoCentavos: 0 },
    "POST /api/financeiro/lancamentos": { ids: ["novo"], lancamentos: [] },
    "POST /api/financeiro/lancamentos/l1/baixa": lanc({ situacao: "REALIZADO" }),
    "PATCH /api/financeiro/lancamentos/l1": lanc(),
  });
}

const gerente = () => sessaoFicticia("FIN", ["financeiro:ver", "financeiro:gerenciar"], { unidades: [FLN] });

describe("Contas a pagar", () => {
  it("filtra pela coluna como no Excel (só uma placa) e classifica de Z a A", async () => {
    api([
      lanc(),
      lanc({ id: "l2", descricao: "Óleo do trem", veiculo: "TREM 01", valorCentavos: 5000 }),
      lanc({ id: "l3", descricao: "Aluguel", veiculo: null, linha: null, unidadeId: null, valorCentavos: 300000 }),
    ]);
    renderizar(<Lancamentos tipo="PAGAR" />, { sessao: gerente() });
    const u = userEvent.setup();
    await screen.findByText("Óleo do trem");
    await u.click(screen.getByRole("button", { name: /Centro de custo/ }));
    const menu = screen.getByRole("dialog", { name: "Filtrar Centro de custo" });
    await u.click(within(menu).getByLabelText("(Selecionar tudo)"));
    await u.click(within(menu).getByLabelText(/TREM 01/));
    await u.click(within(menu).getByRole("button", { name: "Aplicar" }));
    expect(screen.getByText("Óleo do trem")).toBeInTheDocument();
    expect(screen.queryByText("Combustível outubro")).not.toBeInTheDocument();
    expect(screen.getByText(/1 de 3 lançamento\(s\) no filtro das colunas/)).toBeInTheDocument();
    expect(screen.getByText(/Soma R\$\s?50,00/)).toBeInTheDocument();
    // Limpa e ordena a descrição de Z a A.
    await u.click(screen.getByRole("button", { name: /Centro de custo/ }));
    await u.click(within(screen.getByRole("dialog", { name: "Filtrar Centro de custo" })).getByRole("button", { name: "Limpar" }));
    await u.click(screen.getByRole("button", { name: /Descrição/ }));
    await u.click(screen.getByRole("button", { name: "Classificar de Z a A" }));
    const linhas = screen.getAllByRole("row").slice(1, 4).map((r) => r.textContent ?? "");
    expect(linhas[0]).toMatch(/Óleo do trem/);
    expect(linhas[2]).toMatch(/Aluguel/);
  });

  it("ao escolher o banco no filtro mostra recebido, pago, resultado e saldo da conta", async () => {
    api([lanc()]);
    renderizar(<Lancamentos tipo="PAGAR" />, { sessao: gerente() });
    const u = userEvent.setup();
    await screen.findByText("Combustível outubro");
    await u.click(screen.getByRole("button", { name: /Filtros/ }));
    await u.selectOptions(await screen.findByLabelText(/Banco/), "k1");
    expect(await screen.findByText("Resultado do mês")).toBeInTheDocument();
    expect(screen.getByText("Saldo atual da conta")).toBeInTheDocument();
  });

  it("lista com situação, centro de custo e totais; leitor não vê botões de ação", async () => {
    api([lanc({ vencido: true }), lanc({ id: "l2", descricao: "Peças", situacao: "REALIZADO", pagoEm: "2026-11-02", valorPagoCentavos: 12000, valorCentavos: 11000, conciliado: true })]);
    renderizar(<Lancamentos tipo="PAGAR" />, { sessao: sessaoFicticia("LEITOR", ["financeiro:ver"], { unidades: [FLN] }) });
    expect(await screen.findByText("Combustível outubro")).toBeInTheDocument();
    expect(screen.getByText("Vencida")).toBeInTheDocument();
    expect(screen.getByText("Conciliado")).toBeInTheDocument();
    expect(screen.getByText(/devido/)).toHaveTextContent(/110,00/);
    expect(screen.getAllByText("ABC1D23")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Nova conta a pagar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pagar" })).not.toBeInTheDocument();
  });

  it("cria lançamento parcelado enviando centavos inteiros", async () => {
    const spy = api([]);
    renderizar(<Lancamentos tipo="PAGAR" />, { sessao: gerente() });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Nova conta a pagar" }));
    const dialogo = await screen.findByRole("dialog");
    const d = within(dialogo);
    await u.type(d.getByLabelText("Descrição"), "Pneus novos");
    await u.selectOptions(d.getByLabelText("Categoria"), "c-comb");
    await u.type(d.getByLabelText(/^Valor/), "12,345");
    await u.selectOptions(d.getByLabelText("Repetição"), "PARCELADO");
    await u.clear(d.getByLabelText("Número de parcelas"));
    await u.type(d.getByLabelText("Número de parcelas"), "3");
    await u.click(d.getByRole("button", { name: "Lançar" }));
    // três casas decimais: recusado na tela, nada é enviado nem arredondado
    expect(await d.findByRole("alert")).toHaveTextContent(/duas casas decimais/);
    expect(spy.mock.calls.some(([, i]) => (i?.method ?? "GET") === "POST")).toBe(false);
    await u.clear(d.getByLabelText(/^Valor/));
    await u.type(d.getByLabelText(/^Valor/), "1.234,56");
    await u.click(d.getByRole("button", { name: "Lançar" }));
    await screen.findByText("Lançamento salvo.");
    expect(corpoEnviado(spy, "POST", "/api/financeiro/lancamentos")).toMatchObject({
      tipo: "PAGAR", descricao: "Pneus novos", categoriaId: "c-comb", valorCentavos: 123456, unidadeId: FLN.id, repeticao: { tipo: "PARCELADO", parcelas: 3 },
    });
  });

  it("lançamento conciliado: valor, datas e conta ficam travados", async () => {
    api([lanc({ conciliado: true, situacao: "REALIZADO", pagoEm: "2026-11-10", valorPagoCentavos: 100000, contaId: "k1" })]);
    renderizar(<Lancamentos tipo="PAGAR" />, { sessao: gerente() });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Editar" }));
    const d = within(await screen.findByRole("dialog"));
    expect(d.getByText(/conciliado com o extrato/)).toBeInTheDocument();
    expect(d.getByLabelText(/^Valor/)).toBeDisabled();
    expect(d.getByLabelText("Vencimento")).toBeDisabled();
    expect(d.getByLabelText("Competência")).toBeDisabled();
    expect(d.getByLabelText("Conta")).toBeDisabled();
    expect(d.getByLabelText("Descrição")).toBeEnabled();
  });

  it("baixa mostra o total com juros, multa e desconto e envia centavos", async () => {
    const spy = api([lanc()]);
    renderizar(<Lancamentos tipo="PAGAR" />, { sessao: gerente() });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Pagar" }));
    const d = within(await screen.findByRole("dialog"));
    await u.selectOptions(d.getByLabelText("Conta"), "k1");
    await u.type(d.getByLabelText("Juros (R$)"), "12,34");
    await u.type(d.getByLabelText("Multa (R$)"), "20,00");
    await u.type(d.getByLabelText("Desconto (R$)"), "5");
    expect(d.getByText(/Valor pago/)).toHaveTextContent(/1\.027,34/);
    await u.click(d.getByRole("button", { name: "Confirmar pagamento" }));
    await screen.findByText("Baixa registrada.");
    expect(corpoEnviado(spy, "POST", "/api/financeiro/lancamentos/l1/baixa")).toMatchObject({ contaId: "k1", jurosCentavos: 1234, multaCentavos: 2000, descontoCentavos: 500 });
  });

  it("recusa desconto maior que o valor devido", async () => {
    const spy = api([lanc()]);
    renderizar(<Lancamentos tipo="PAGAR" />, { sessao: gerente() });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Pagar" }));
    const d = within(await screen.findByRole("dialog"));
    await u.selectOptions(d.getByLabelText("Conta"), "k1");
    await u.type(d.getByLabelText("Desconto (R$)"), "1000");
    await u.click(d.getByRole("button", { name: "Confirmar pagamento" }));
    expect(await d.findByRole("alert")).toHaveTextContent(/desconto não pode/);
    expect(spy.mock.calls.some(([u2]) => String(u2).endsWith("/baixa"))).toBe(false);
  });
});

describe("Contas a receber", () => {
  it("usa categorias de receita e mostra o canal de venda", async () => {
    api([]);
    renderizar(<Lancamentos tipo="RECEBER" />, { sessao: gerente() });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Nova conta a receber" }));
    const d = within(await screen.findByRole("dialog"));
    expect(within(d.getByLabelText("Categoria")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Escolha…", "Fretamento"]);
    expect(d.getByLabelText("Canal de venda")).toBeInTheDocument();
  });
});
