import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { Caixa } from "./Caixa";
import { ImportacoesFeitas, ImportarPlanilha } from "./ImportarPlanilha";
import { Resumo } from "./Resumo";
import type { CaixaDia, PreviaPlanilha, RespostaResumo } from "./tipos";

const vazio = { total: 0, linhas: [] };
const previa = (extra: Partial<PreviaPlanilha> = {}): PreviaPlanilha => ({
  previa: true, layout: "NOVO", cabecalhoLinha: 3, lidos: 5, novos: { lancamentos: 4, transferencias: 1 }, jaExistentes: 0, abertos: 1, realizados: 3, transferencias: 1, contasACriar: ["Sicredi"],
  porConta: [{ coluna: "SICREDI", rotulo: "Sicredi", conta: "Sicredi", criar: true, qtd: 3, entradasCentavos: 500000, saidasCentavos: 150000 }],
  saldos: [{ coluna: "SICREDI", rotulo: "Sicredi", valorCentavos: 1000000, data: "2026-10-02", aplicar: false, motivo: "Diverge do saldo calculado pelo sistema: conferir.", calculadoCentavos: 1247197, divergenciaCentavos: -247197 }],
  naoReconhecidos: [{ chave: "AGENDA|LEMBRETE", grupo: "AGENDA", categoria: "LEMBRETE", qtd: 1, totalCentavos: 1000 }],
  qualidade: { dataInvalida: { total: 1, linhas: [{ linha: 14, texto: "03/06" }] }, mesDiferente: vazio, anoFora: vazio, grupoVazio: vazio, grafias: [{ canonico: "FROTA", variantes: [{ texto: "FOTA", qtd: 1 }, { texto: "FROTA", qtd: 2 }] }], duplicadas: { total: 1, grupos: [{ linhas: [17, 18], data: "2026-09-12", fornecedor: "MOTORISTA TESTE", valorCentavos: 15000 }] }, pessoaFisica: vazio, previstas: 1, apagarSemConta: 0, apagarDiferente: 0 },
  avisos: ["Layout novo detectado (saídas negativas em cada conta)."], ignoradas: 1, erros: [], totalErros: 0,
  amostra: [{ data: "2026-10-05", tipo: "PAGAR", aberto: false, descricao: "Revisão ABC-1D23", categoria: "Manutenção da frota", fornecedor: "Oficina Teste", valorCentavos: 150000, conta: "Sicredi" }], ...extra,
});
const gerente = () => sessaoFicticia("FIN", ["financeiro:ver", "financeiro:gerenciar"], { unidades: [FLN] });
const categorias = [{ id: "c-outras", codigo: "DESP_OUTRAS", nome: "Outras despesas", tipo: "DESPESA", grupo: "Administrativo", ordem: 1, ativa: true, sistema: true }];

function arquivo(nome = "aba.csv") {
  const f = new File(["x"], nome, { type: "text/csv" });
  Object.defineProperty(f, "arrayBuffer", { value: async () => new TextEncoder().encode("MÊS,DATA,CAT,FORNECEDOR,DESCRIÇÃO, SICREDI \n").buffer });
  return f;
}

describe("Importar planilha", () => {
  it("mostra a prévia com qualidade, saldos com divergência e o que não foi reconhecido; mapeia e confirma", async () => {
    const spy = simularApi({
      "GET /api/financeiro/categorias": categorias,
      "GET /api/financeiro/importacoes": { itens: [] },
      "POST /api/financeiro/planilha/importar": (corpo: unknown) => ((corpo as { confirmar?: boolean }).confirmar ? { ...previa(), previa: false, resultado: { lancamentos: 4, transferencias: 1, jaExistentes: 0, contasCriadas: ["Sicredi"], saldosAplicados: 0, fornecedores: 1, sinonimosSalvos: 1 } } : previa()),
    });
    renderizar(<ImportarPlanilha />, { sessao: gerente() });
    const u = userEvent.setup();
    await u.upload(screen.getByLabelText(/Arquivo do Excel/), arquivo());
    expect(await screen.findByText(/layout novo, cabeçalho na linha 3/)).toBeInTheDocument();
    expect(screen.getByText(/divergência de/)).toBeInTheDocument();
    const qualidade = within(screen.getByRole("list", { name: "Conferência de qualidade" }));
    expect(qualidade.getByText(/Datas vazias ou inválidas/)).toHaveTextContent(/linha 14 \("03\/06"\)/);
    expect(qualidade.getByText(/Possíveis duplicadas/)).toHaveTextContent(/linhas 17 e 18/);
    expect(screen.getByText(/Grafias diferentes do mesmo grupo/)).toHaveTextContent(/FOTA/);
    expect(corpoEnviado(spy, "POST", "/api/financeiro/planilha/importar")).toMatchObject({ unidadeId: FLN.id, mapeamentos: {}, arquivo: "aba.csv" });
    // mapear o que não foi reconhecido e atualizar a prévia
    await u.selectOptions(screen.getByLabelText(/AGENDA › LEMBRETE/), "c-outras");
    await u.click(screen.getByRole("button", { name: "Atualizar prévia" }));
    expect(corpoEnviado(spy, "POST", "/api/financeiro/planilha/importar", 1)).toMatchObject({ mapeamentos: { "AGENDA|LEMBRETE": "c-outras" } });
    await u.click(screen.getByRole("button", { name: /Importar 4 lançamento/ }));
    await screen.findByText("Importação concluída");
    expect(corpoEnviado(spy, "POST", "/api/financeiro/planilha/importar", 2)).toMatchObject({ confirmar: true, salvarSinonimos: true, mapeamentos: { "AGENDA|LEMBRETE": "c-outras" } });
  });

  it("não aceita o .xls antigo e explica como salvar em .xlsx", async () => {
    simularApi({ "GET /api/financeiro/categorias": categorias, "GET /api/financeiro/importacoes": { itens: [] } });
    renderizar(<ImportarPlanilha />, { sessao: gerente() });
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText(/Arquivo do Excel/), arquivo("aba.xls"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/formato antigo do Excel \(\.xls\).*Salvar como/);
  });

  it("linhas com valor inválido bloqueiam o botão de importar", async () => {
    simularApi({ "GET /api/financeiro/categorias": categorias, "GET /api/financeiro/importacoes": { itens: [] }, "POST /api/financeiro/planilha/importar": previa({ naoReconhecidos: [], erros: [{ linha: 9, motivo: "Valor inválido na coluna Sicredi." }], totalErros: 1 }) });
    renderizar(<ImportarPlanilha />, { sessao: gerente() });
    await userEvent.setup().upload(screen.getByLabelText(/Arquivo do Excel/), arquivo());
    await screen.findByText(/1 linha\(s\) com valor inválido/);
    expect(screen.getByRole("button", { name: /Importar/ })).toBeDisabled();
  });
});

describe("Caixa em dinheiro", () => {
  const dia = (extra: Partial<CaixaDia> = {}): CaixaDia => ({
    conta: { id: "cx", nome: "Quiosque" }, data: "2026-10-09", saldoInicialCentavos: 30000, entradasCentavos: 25000, saidasCentavos: 8000, saldoCalculadoCentavos: 47000, fechamento: null, lancamentos: [], recentes: [], ...extra,
  });
  const conta = { id: "cx", unidadeId: FLN.id, nome: "Quiosque", tipo: "CAIXA", banco: null, finalConta: null, saldoInicialCentavos: 0, saldoInicialEm: null, diaFechamento: null, diaVencimento: null, contaPagamentoId: null, ativa: true, saldoCentavos: 47000, linhasPendentes: 0 };

  it("mostra o dia e envia o saldo contado em centavos; a diferença aparece antes de fechar", async () => {
    const spy = simularApi({
      "GET /api/financeiro/contas": [conta],
      "GET /api/financeiro/caixa/dia": dia(),
      "GET /api/financeiro/contas/cx/saldo-diario": { conta: { id: "cx", nome: "Quiosque", tipo: "CAIXA" }, saldoInicialCentavos: 30000, dias: [{ data: "2026-10-09", entradasCentavos: 25000, saidasCentavos: 8000, saldoFinalCentavos: 47000 }] },
      "POST /api/financeiro/caixa/fechar": { ok: true },
    });
    renderizar(<Caixa />, { sessao: gerente() });
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Saldo contado no caixa (R$)"), "465,00");
    expect(screen.getByText(/Diferença:/)).toHaveTextContent(/-R\$ 5,00|R\$ -5,00|−R\$ 5,00/);
    await u.click(screen.getByRole("button", { name: "Fechar o dia" }));
    await screen.findByText("Caixa do dia fechado.");
    expect(corpoEnviado(spy, "POST", "/api/financeiro/caixa/fechar")).toMatchObject({ contaId: "cx", saldoContadoCentavos: 46500 });
    expect(screen.getByRole("table", { name: /Saldo diário de Quiosque/ })).toBeInTheDocument();
  });

  it("dia fechado não oferece novo fechamento", async () => {
    simularApi({
      "GET /api/financeiro/contas": [conta],
      "GET /api/financeiro/caixa/dia": dia({ fechamento: { saldoContadoCentavos: 46500, diferencaCentavos: -500, observacao: null, fechadoEm: "2026-10-09T22:00:00Z" } }),
      "GET /api/financeiro/contas/cx/saldo-diario": { conta: { id: "cx", nome: "Quiosque", tipo: "CAIXA" }, saldoInicialCentavos: 0, dias: [] },
    });
    renderizar(<Caixa />, { sessao: gerente() });
    expect(await screen.findByText("Dia fechado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fechar o dia" })).not.toBeInTheDocument();
  });
});

describe("Resumo do mês como na planilha", () => {
  it("mostra o quadro de saldos por tipo, o total disponível, o pessoal fora do resultado e o resultado", async () => {
    const resumo: RespostaResumo = {
      hoje: "2026-10-31", mes: "2026-10", aPagar: { abertoCentavos: 0, abertoQtd: 0, realizadoCentavos: 0, realizadoQtd: 0 }, aReceber: { abertoCentavos: 0, abertoQtd: 0, realizadoCentavos: 0, realizadoQtd: 0 },
      vencidas: { pagar: { qtd: 0, centavos: 0 }, receber: { qtd: 0, centavos: 0 } },
      saldos: [{ contaId: "a", nome: "Sicredi", tipo: "CORRENTE", saldoCentavos: 1247197 }, { contaId: "b", nome: "Quiosque", tipo: "CAIXA", saldoCentavos: 47000 }, { contaId: "c", nome: "Aplicação", tipo: "APLICACAO", saldoCentavos: 50000 }, { contaId: "d", nome: "Cartão", tipo: "CARTAO", saldoCentavos: -6000 }],
      saldoCaixaCentavos: 1344197, fluxo: [], linhasPendentes: 0,
      receitaPorConta: [{ contaId: "a", nome: "Sicredi", totalCentavos: 623456 }, { contaId: "b", nome: "Quiosque", totalCentavos: 25000 }],
      dre: {
        receitaCentavos: 648456, despesaCentavos: 565259, resultadoCentavos: 83197, margemPontosBase: 1283,
        grupos: [{ grupo: "Receita", tipo: "RECEITA", totalCentavos: 648456, categorias: [] }, { grupo: "Frota", tipo: "DESPESA", totalCentavos: 236025, categorias: [] }, { grupo: "RH", tipo: "DESPESA", totalCentavos: 200000, categorias: [] }],
        porPracaLinha: [], foraDoResultado: [{ grupo: "Pessoal (despesas pessoais pagas pela empresa)", entradasCentavos: 0, saidasCentavos: 15000, categorias: [] }], pessoalCentavos: 15000, resultadoAposPessoalCentavos: 68197,
      },
    };
    simularApi({ "GET /api/financeiro/resumo": resumo });
    renderizar(<Resumo />, { sessao: gerente() });
    const saldos = within(await screen.findByRole("region", { name: "Saldos das contas" }));
    expect(saldos.getByText("Bancos")).toBeInTheDocument();
    expect(saldos.getByText("Caixa em dinheiro (quiosque)")).toBeInTheDocument();
    expect(saldos.getByText("Aplicação", { selector: "h3" })).toBeInTheDocument();
    expect(saldos.getByText(/Total disponível/)).toHaveTextContent(/13\.441,97/);
    // O quadro "como na planilha" saiu em 10/11/2026: a aba DRE substitui (com os grupos novos).
    expect(screen.queryByRole("region", { name: /como na planilha/ })).not.toBeInTheDocument();
    const dre = within(screen.getByRole("region", { name: /DRE gerencial/ }));
    expect(dre.getByRole("row", { name: /Resultado do mês/ })).toHaveTextContent(/831,97/);
    expect(dre.getByRole("link", { name: /DRE completa/ })).toHaveAttribute("href", "/financeiro/dre");
  });
});

describe("Importações feitas", () => {
  it("lista as importações e desfaz uma depois de confirmar", async () => {
    const item = { id: "i1", unidadeId: FLN.id, arquivo: "OUT2026.csv", origem: "PLANILHA", lancamentos: 13, transferencias: 2, criadoEm: "2026-11-10T13:00:00Z", criadoPor: "Pessoa Fictícia", desfeitaEm: null, resultadoDesfazer: null, restantes: 13 };
    const spy = simularApi({
      "GET /api/financeiro/importacoes": { itens: [item] },
      "POST /api/financeiro/importacoes/i1/desfazer": { lancamentosApagados: 13, transferenciasApagadas: 4, mantidos: 0, saldosRestaurados: 1 },
    });
    renderizar(<ImportacoesFeitas atualizar={0} />, { sessao: gerente() });
    const linha = await screen.findByRole("row", { name: /OUT2026\.csv/ });
    expect(linha).toHaveTextContent("Pessoa Fictícia");
    await userEvent.click(within(linha).getByRole("button", { name: /Desfazer a importação/ }));
    const dialogo = screen.getByRole("dialog", { name: "Desfazer importação" });
    expect(dialogo).toHaveTextContent(/13 lançamento\(s\)/);
    await userEvent.click(within(dialogo).getByRole("button", { name: "Desfazer importação" }));
    expect(spy.mock.calls.some(([u, i]) => String(u).endsWith("/api/financeiro/importacoes/i1/desfazer") && i?.method === "POST")).toBe(true);
  });
});
