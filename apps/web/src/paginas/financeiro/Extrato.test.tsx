import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { Extrato, PainelLinhas } from "./Extrato";
import type { ContaFin, LinhaExtratoFin, SugestaoConc } from "./tipos";

const conta: ContaFin = { id: "k1", unidadeId: FLN.id, nome: "Corrente Teste", tipo: "CORRENTE", banco: null, finalConta: null, saldoInicialCentavos: 0, saldoInicialEm: null, diaFechamento: null, diaVencimento: null, contaPagamentoId: null, ativa: true, saldoCentavos: 0, linhasPendentes: 2 };

const sugestao = (extra: Partial<SugestaoConc> = {}): SugestaoConc => ({
  lancamentoId: "lan1", pontos: 95, nivel: "ALTA", diferencaCentavos: 0, motivos: ["Valor exato", "Mesma data do vencimento"],
  lancamento: { descricao: "Combustível outubro", contraparte: "Posto Teste", valorCentavos: 123456, vencimento: "2026-10-03", categoriaNome: "Combustível" }, ...extra,
});
const linha = (extra: Partial<LinhaExtratoFin> = {}): LinhaExtratoFin => ({
  id: "ln1", data: "2026-10-03", valorCentavos: -123456, descricao: "PAGTO POSTO TESTE", documento: null, status: "PENDENTE", lancamentoId: null, lancamentoDescricao: null, parLinhaId: null, manual: false, observacao: null,
  sugestoes: [sugestao()], pares: [], categoriaSugerida: null, ...extra,
});

function api(linhas: LinhaExtratoFin[]) {
  return simularApi({
    "GET /api/financeiro/categorias": [],
    "GET /api/financeiro/extrato/linhas": { conta: { id: "k1", nome: "Corrente Teste", tipo: "CORRENTE" }, linhas, total: linhas.length, porStatus: { PENDENTE: linhas.length } },
    "POST /api/financeiro/extrato/linhas/ln1/conciliar": { ok: true },
    "POST /api/financeiro/extrato/linhas/ln1/recusar": { ok: true },
    "POST /api/financeiro/extrato/linhas/ln1/ignorar": { ok: true },
    "POST /api/financeiro/extrato/linhas/ln1/transferencia": { ok: true },
  });
}
const gerente = () => sessaoFicticia("FIN", ["financeiro:ver", "financeiro:gerenciar"], { unidades: [FLN] });

describe("Conciliação", () => {
  it("mostra a sugestão e só concilia quando a pessoa confirma", async () => {
    const spy = api([linha()]);
    renderizar(<PainelLinhas conta={conta} versao={0} />, { sessao: gerente() });
    expect(await screen.findByText(/Sugestão \(alta confiança\)/)).toBeInTheDocument();
    expect(spy.mock.calls.some(([u]) => String(u).includes("/conciliar"))).toBe(false);
    await userEvent.setup().click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByText("Conciliado.");
    expect(corpoEnviado(spy, "POST", "/api/financeiro/extrato/linhas/ln1/conciliar")).toEqual({ lancamentoId: "lan1" });
  });

  it("recusar a sugestão envia o lançamento recusado", async () => {
    const spy = api([linha()]);
    renderizar(<PainelLinhas conta={conta} versao={0} />, { sessao: gerente() });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Recusar" }));
    await screen.findByText("Sugestão recusada.");
    expect(corpoEnviado(spy, "POST", "/api/financeiro/extrato/linhas/ln1/recusar")).toEqual({ lancamentoId: "lan1" });
  });

  it("diferença de valor exige escolher juros, multa ou desconto", async () => {
    const spy = api([linha({ valorCentavos: -124456, sugestoes: [sugestao({ diferencaCentavos: 1000 })] })]);
    renderizar(<PainelLinhas conta={conta} versao={0} />, { sessao: gerente() });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: "Confirmar" }));
    const d = within(await screen.findByRole("dialog"));
    expect(d.getByRole("button", { name: "Conciliar" })).toBeDisabled();
    expect(within(d.getByLabelText("A diferença é")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Escolha…", "Juros", "Multa"]);
    await u.selectOptions(d.getByLabelText("A diferença é"), "MULTA");
    await u.click(d.getByRole("button", { name: "Conciliar" }));
    await screen.findByText("Conciliado.");
    expect(corpoEnviado(spy, "POST", "/api/financeiro/extrato/linhas/ln1/conciliar")).toEqual({ lancamentoId: "lan1", diferenca: "MULTA" });
  });

  it("sugere transferência quando há linha oposta em outra conta", async () => {
    const spy = api([linha({ sugestoes: [], pares: [{ id: "par1", contaId: "k2", contaNome: "Cartão Teste", data: "2026-10-04", descricao: "PGTO FATURA" }] })]);
    renderizar(<PainelLinhas conta={conta} versao={0} />, { sessao: gerente() });
    await userEvent.setup().click(await screen.findByRole("button", { name: "Marcar transferência" }));
    await screen.findByText("Transferência registrada.");
    expect(corpoEnviado(spy, "POST", "/api/financeiro/extrato/linhas/ln1/transferencia")).toEqual({ parLinhaId: "par1" });
  });

  it("leitor vê as sugestões mas não tem botões de decisão", async () => {
    api([linha()]);
    renderizar(<PainelLinhas conta={conta} versao={0} />, { sessao: sessaoFicticia("LEITOR", ["financeiro:ver"], { unidades: [FLN] }) });
    expect(await screen.findByText("PAGTO POSTO TESTE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ignorar" })).not.toBeInTheDocument();
  });

  it("linha conciliada oferece desfazer; valores de saída aparecem com sinal negativo", async () => {
    api([linha({ status: "CONCILIADO", lancamentoId: "lan1", lancamentoDescricao: "Combustível outubro", sugestoes: undefined })]);
    renderizar(<PainelLinhas conta={conta} versao={0} />, { sessao: gerente() });
    expect(await screen.findByText("Conciliada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeInTheDocument();
    expect(screen.getByText(/-.*1\.234,56/)).toBeInTheDocument();
  });
});

describe("Importador e busca", () => {
  const outra: ContaFin = { ...conta, id: "k2", nome: "Corrente Outra" };
  const previa = (id: string) => ({ previa: true, previaId: id.repeat(64).slice(0, 64), total: 1, novas: 1, repetidas: 0, ignoradas: [], avisos: [], inicio: "2026-10-03", fim: "2026-10-03", amostra: [{ data: "2026-10-03", valorCentavos: -1000, descricao: "Teste" }] });

  function arquivo() {
    const f = new File(["Data;Descrição;Valor\n03/10/2026;Teste;-10,00\n"], "extrato.csv", { type: "text/csv" });
    Object.defineProperty(f, "arrayBuffer", { value: async () => new TextEncoder().encode("Data;Descrição;Valor\n03/10/2026;Teste;-10,00\n").buffer });
    return f;
  }

  it("trocar de conta descarta o arquivo e a prévia: a confirmação nunca vai para a conta nova", async () => {
    const spy = simularApi({
      "GET /api/financeiro/contas": [conta, outra],
      "GET /api/financeiro/categorias": [],
      "GET /api/financeiro/extrato/linhas": { conta: { id: "k1", nome: "Corrente Teste", tipo: "CORRENTE" }, linhas: [], total: 0, porStatus: {} },
      "POST /api/financeiro/extratos/importar": previa("a"),
    });
    renderizar(<Extrato />, { sessao: gerente() });
    const u = userEvent.setup();
    await u.upload(await screen.findByLabelText("Arquivo"), arquivo());
    expect(await screen.findByRole("button", { name: /Importar 1 lançamento/ })).toBeInTheDocument();
    expect(corpoEnviado(spy, "POST", "/api/financeiro/extratos/importar")).toMatchObject({ contaId: "k1", confirmar: false });
    await u.selectOptions(screen.getByLabelText("Conta"), "k2");
    expect(screen.queryByRole("button", { name: /Importar 1 lançamento/ })).not.toBeInTheDocument();
    expect(spy.mock.calls.filter(([, i]) => (i?.method ?? "GET") === "POST" && JSON.parse(String(i?.body)).confirmar === true)).toHaveLength(0);
  });

  it("a confirmação leva o identificador da prévia", async () => {
    const spy = simularApi({
      "GET /api/financeiro/contas": [conta],
      "GET /api/financeiro/categorias": [],
      "GET /api/financeiro/extrato/linhas": { conta: { id: "k1", nome: "Corrente Teste", tipo: "CORRENTE" }, linhas: [], total: 0, porStatus: {} },
      "POST /api/financeiro/extratos/importar": (corpo: unknown) => ((corpo as { confirmar: boolean }).confirmar ? { ...previa("b"), previa: false } : previa("b")),
    });
    renderizar(<Extrato />, { sessao: gerente() });
    const u = userEvent.setup();
    await u.upload(await screen.findByLabelText("Arquivo"), arquivo());
    await u.click(await screen.findByRole("button", { name: /Importar 1 lançamento/ }));
    await screen.findByText(/importado/);
    expect(corpoEnviado(spy, "POST", "/api/financeiro/extratos/importar", 1)).toMatchObject({ confirmar: true, previaId: "b".repeat(64) });
  });

  it("a busca espera a pessoa parar de digitar: uma só requisição, já na página 1", async () => {
    const spy = simularApi({
      "GET /api/financeiro/categorias": [],
      "GET /api/financeiro/extrato/linhas": { conta: { id: "k1", nome: "Corrente Teste", tipo: "CORRENTE" }, linhas: [], total: 0, porStatus: {} },
    });
    renderizar(<PainelLinhas conta={conta} versao={0} />, { sessao: gerente() });
    await screen.findByText(/Nada pendente/);
    const antes = spy.mock.calls.filter(([u]) => String(u).includes("/extrato/linhas")).length;
    await userEvent.setup().type(screen.getByLabelText("Buscar"), "posto");
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes("q=posto"))).toBe(true));
    const urls = spy.mock.calls.map(([u]) => String(u)).filter((u) => u.includes("/extrato/linhas"));
    expect(urls.length).toBe(antes + 1);
    expect(urls.at(-1)).toContain("pagina=1");
    expect(urls.some((u) => /q=(p|po|pos|post)(&|$)/.test(u))).toBe(false);
  });
});
