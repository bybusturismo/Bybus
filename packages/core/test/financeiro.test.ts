import { describe, expect, it } from "vitest";
import {
  classificar, extrairPlaca, lerPlanilhaFinanceira, montarDicionario, separarObs, SINONIMOS_PADRAO, valorPlanilha, GRUPO_PESSOAL,
  calcularBaixa, centavosParaTexto, faturaDaData, chaveLinha, dataFlexivel, inicioDaSemana, lerCsvExtrato, lerOfx, montarDre, montarFluxoSemanal,
  paraCentavos, parcelar, prepararLinhas, somarMeses, sugerirCategoria, sugerirCorrespondencias,
  type CategoriaInfo, type LancamentoRelatorio,
} from "../src/index.js";

describe("dinheiro em centavos", () => {
  it("converte textos em formato brasileiro e internacional sem arredondar", () => {
    expect(paraCentavos("1.234,56")).toBe(123456);
    expect(paraCentavos("1234.56")).toBe(123456);
    expect(paraCentavos("R$ 10,00")).toBe(1000);
    expect(paraCentavos("-5")).toBe(-500);
    expect(paraCentavos("(10,50)")).toBe(-1050);
    expect(paraCentavos("10,50 D")).toBe(-1050);
    expect(paraCentavos("0,05")).toBe(5);
    expect(paraCentavos("1.234")).toBe(123400);
    expect(paraCentavos("12,345")).toBeNull(); // três casas: não arredonda, recusa
    expect(paraCentavos("abc")).toBeNull();
    expect(paraCentavos("")).toBeNull();
    expect(paraCentavos("19.99")).toBe(1999);
    expect(paraCentavos("0.1")).toBe(10);
  });

  it("formata centavos em texto", () => {
    expect(centavosParaTexto(123456)).toBe("1.234,56");
    expect(centavosParaTexto(-5)).toBe("-0,05");
  });

  it("parcela sem perder centavos", () => {
    expect(parcelar(10000, 3)).toEqual([3334, 3333, 3333]);
    for (const [total, n] of [[1, 1], [100, 7], [99999, 12], [1000001, 36]] as const) {
      const p = parcelar(total, n);
      expect(p).toHaveLength(n);
      expect(p.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.max(...p) - Math.min(...p)).toBeLessThanOrEqual(1);
    }
    expect(() => parcelar(2, 3)).toThrow();
    expect(() => parcelar(0, 1)).toThrow();
    expect(() => parcelar(100.5, 2)).toThrow();
  });

  it("soma meses mantendo o fim do mês", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
    expect(somarMeses("2026-11-15", 3)).toBe("2027-02-15");
    expect(somarMeses("2026-03-10", -3)).toBe("2025-12-10");
  });

  it("calcula a baixa com juros, multa e desconto", () => {
    expect(calcularBaixa({ valorCentavos: 10000, jurosCentavos: 150, multaCentavos: 200, descontoCentavos: 50 })).toBe(10300);
    expect(() => calcularBaixa({ valorCentavos: 100, descontoCentavos: 100 })).toThrow();
    expect(() => calcularBaixa({ valorCentavos: 100, jurosCentavos: 1.5 })).toThrow();
  });
});

const OFX = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>756<BRANCHID>3000<ACCTID>123456-7</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261031
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003120000[-3:BRT]<TRNAMT>-1234.56<FITID>A1<MEMO>PAGTO POSTO ILHA
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005<TRNAMT>2500,00<FITID>A2<NAME>PIX RECEBIDO<MEMO>PAYTOUR
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006<TRNAMT>0.00<FITID>A3<MEMO>ZERADO
</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>10000.00<DTASOF>20261031</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("leitura de extrato", () => {
  it("lê OFX SGML com valores em centavos e ignora linha zerada", () => {
    const r = lerOfx(OFX);
    expect(r.banco).toBe("756");
    expect(r.inicio).toBe("2026-10-01");
    expect(r.saldoCentavos).toBe(1000000);
    expect(r.linhas).toEqual([
      { fitid: "A1", data: "2026-10-03", valorCentavos: -123456, descricao: "PAGTO POSTO ILHA", documento: null },
      { fitid: "A2", data: "2026-10-05", valorCentavos: 250000, descricao: "PIX RECEBIDO · PAYTOUR", documento: null },
    ]);
    expect(r.ignoradas).toHaveLength(1);
    expect(() => lerOfx("isto não é OFX")).toThrow(/OFX/);
  });

  it("lê CSV com valor único ou com crédito e débito", () => {
    const a = lerCsvExtrato("Data;Descrição;Valor\n03/10/2026;Posto Ilha;-1.234,56\n05/10/2026;Pix Paytour;2.500,00\nxx;lixo;1,00\n");
    expect(a.linhas.map((l) => [l.data, l.valorCentavos])).toEqual([["2026-10-03", -123456], ["2026-10-05", 250000]]);
    expect(a.ignoradas).toHaveLength(1);
    const b = lerCsvExtrato("Data,Histórico,Crédito,Débito\n2026-10-03,Venda,100.00,\n2026-10-04,Combustível,,50.25\n");
    expect(b.linhas.map((l) => l.valorCentavos)).toEqual([10000, -5025]);
  });

  it("fatura de cartão em CSV inverte o sinal (compra vira saída)", () => {
    const r = lerCsvExtrato("Data;Estabelecimento;Valor\n10/10/2026;Posto X;150,00\n12/10/2026;Estorno;-20,00\n", { faturaCartao: true });
    expect(r.linhas.map((l) => l.valorCentavos)).toEqual([-15000, 2000]);
    expect(r.ehCartao).toBe(true);
  });

  it("recusa CSV sem cabeçalho reconhecível", () => {
    expect(() => lerCsvExtrato("a;b\n1;2\n")).toThrow(/Cabeçalho/);
  });

  it("datas em vários formatos", () => {
    expect(dataFlexivel("03/10/2026")).toBe("2026-10-03");
    expect(dataFlexivel("3-1-26")).toBe("2026-01-03");
    expect(dataFlexivel("31/02/2026")).toBeNull();
  });
});

describe("importação sem duplicar", () => {
  it("linhas iguais no mesmo dia continuam distintas, e reimportar gera os mesmos identificadores", () => {
    const linhas = [
      { fitid: null, data: "2026-10-03", valorCentavos: -1000, descricao: "Pedágio", documento: null },
      { fitid: null, data: "2026-10-03", valorCentavos: -1000, descricao: "PEDÁGIO ", documento: null },
      { fitid: null, data: "2026-10-04", valorCentavos: -1000, descricao: "Pedágio", documento: null },
    ];
    const a = prepararLinhas(linhas).preparadas.map((l) => l.idUnico);
    const b = prepararLinhas(linhas).preparadas.map((l) => l.idUnico);
    expect(new Set(a).size).toBe(3);
    expect(a).toEqual(b);
    expect(chaveLinha(linhas[0]!)).toBe(chaveLinha(linhas[1]!));
  });

  it("FITID repetido no arquivo: igual é descartado, diferente é mantido com sufixo estável", () => {
    const base = { documento: null, data: "2026-10-03" };
    const r = prepararLinhas([
      { ...base, fitid: "X", valorCentavos: -100, descricao: "a" },
      { ...base, fitid: "X", valorCentavos: -100, descricao: "a" },
      { ...base, fitid: "X", valorCentavos: -200, descricao: "b" },
    ]);
    expect(r.repetidasNoArquivo).toBe(1);
    expect(r.preparadas).toHaveLength(2);
    expect(r.preparadas[0]!.idUnico).toBe("X");
    expect(r.preparadas[1]!.idUnico).toMatch(/^X~/);
  });
});

describe("sugestão de conciliação", () => {
  const cands = [
    { id: "posto", tipo: "PAGAR" as const, valorCentavos: 123456, vencimento: "2026-10-03", descricao: "Combustível outubro", contraparte: "Posto Ilha" },
    { id: "posto-aprox", tipo: "PAGAR" as const, valorCentavos: 120000, vencimento: "2026-10-01", descricao: "Combustível", contraparte: "Posto Ilha" },
    { id: "longe", tipo: "PAGAR" as const, valorCentavos: 5000, vencimento: "2026-10-03", descricao: "Outra" },
    { id: "receber", tipo: "RECEBER" as const, valorCentavos: 123456, vencimento: "2026-10-03", descricao: "Venda" },
  ];
  it("valor exato + data + nome vem primeiro; tipo errado e valor distante ficam de fora", () => {
    const r = sugerirCorrespondencias({ valorCentavos: -123456, data: "2026-10-03", descricao: "PAGTO POSTO ILHA" }, cands);
    expect(r.map((x) => x.lancamentoId)).toEqual(["posto", "posto-aprox"]);
    expect(r[0]!.nivel).toBe("ALTA");
    expect(r[0]!.diferencaCentavos).toBe(0);
    expect(r[1]!.diferencaCentavos).toBe(3456);
  });
  it("recusados nunca voltam", () => {
    const r = sugerirCorrespondencias({ valorCentavos: -123456, data: "2026-10-03", descricao: "POSTO" }, cands, new Set(["posto"]));
    expect(r.map((x) => x.lancamentoId)).not.toContain("posto");
  });
  it("entrada casa só com contas a receber", () => {
    const r = sugerirCorrespondencias({ valorCentavos: 123456, data: "2026-10-04", descricao: "PIX" }, cands);
    expect(r.map((x) => x.lancamentoId)).toEqual(["receber"]);
  });
});

describe("regras de categorização (só sugerem)", () => {
  const regras = [
    { id: "r1", texto: "posto", tipo: "DESPESA" as const, categoriaId: "comb", prioridade: 0 },
    { id: "r2", texto: "posto ilha", tipo: null, categoriaId: "comb2", prioridade: 0 },
    { id: "r3", texto: "paytour", tipo: "RECEITA" as const, categoriaId: "site", prioridade: 0 },
  ];
  it("a regra de texto mais específico vence e respeita o sinal", () => {
    expect(sugerirCategoria("PAGTO POSTO ILHA LTDA", -100, regras)?.categoriaId).toBe("comb2");
    expect(sugerirCategoria("Posto Central", -100, regras)?.categoriaId).toBe("comb");
    expect(sugerirCategoria("Repasse PAYTOUR", 100, regras)?.categoriaId).toBe("site");
    expect(sugerirCategoria("Repasse PAYTOUR", -100, regras)).toBeNull();
    expect(sugerirCategoria("sem regra", -100, regras)).toBeNull();
  });
});

describe("fluxo semanal e DRE", () => {
  const base = { valorPagoCentavos: null, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0, pagoEm: null, unidadeId: "fln", linha: "CITY_TOUR" };
  const L = (x: Partial<LancamentoRelatorio>): LancamentoRelatorio => ({ tipo: "PAGAR", situacao: "ABERTO", valorCentavos: 1000, vencimento: "2026-11-04", categoriaId: "c1", ...base, ...x });

  it("semana começa na segunda", () => {
    expect(inicioDaSemana("2026-11-04")).toBe("2026-11-02"); // quarta
    expect(inicioDaSemana("2026-11-08")).toBe("2026-11-02"); // domingo
    expect(inicioDaSemana("2026-11-09")).toBe("2026-11-09");
  });

  it("separa realizado e previsto; vencidas em aberto caem na semana atual", () => {
    const semanas = montarFluxoSemanal({
      hoje: "2026-11-04", semanasAntes: 1, semanasDepois: 2, saldoAtualCentavos: 100000,
      lancamentos: [
        L({ situacao: "REALIZADO", tipo: "RECEBER", valorCentavos: 5000, valorPagoCentavos: 5000, pagoEm: "2026-10-28" }),
        L({ vencimento: "2026-10-01", valorCentavos: 2000 }), // vencida
        L({ tipo: "RECEBER", vencimento: "2026-11-10", valorCentavos: 7000 }),
        L({ vencimento: "2026-12-30" }), // fora da janela
      ],
    });
    expect(semanas.map((s) => s.inicio)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(semanas[0]!.entradasRealizadasCentavos).toBe(5000);
    expect(semanas[0]!.saldoProjetadoCentavos).toBeNull();
    expect(semanas[1]!.saidasPrevistasCentavos).toBe(2000);
    expect(semanas[1]!.saldoProjetadoCentavos).toBe(98000);
    expect(semanas[2]!.saldoProjetadoCentavos).toBe(105000);
    expect(semanas[3]!.saldoProjetadoCentavos).toBe(105000);
  });

  it("DRE soma exato por categoria, grupo e praça/linha, com encargos à parte", () => {
    const cats = new Map<string, CategoriaInfo>([
      ["r", { nome: "Fretamento", tipo: "RECEITA", grupo: "Receitas operacionais", ordem: 1 }],
      ["c1", { nome: "Combustível", tipo: "DESPESA", grupo: "Custos operacionais", ordem: 2 }],
    ]);
    const dre = montarDre([
      L({ tipo: "RECEBER", categoriaId: "r", valorCentavos: 100000, linha: "FRETAMENTO", unidadeId: "bc" }),
      L({ categoriaId: "c1", valorCentavos: 33333 }),
      L({ categoriaId: "c1", valorCentavos: 10000, situacao: "REALIZADO", jurosCentavos: 150, multaCentavos: 200, descontoCentavos: 50, valorPagoCentavos: 10300 }),
    ], cats);
    expect(dre.receitaCentavos).toBe(100000);
    expect(dre.despesaCentavos).toBe(33333 + 10000 + 300);
    expect(dre.resultadoCentavos).toBe(100000 - 43633);
    expect(dre.margemPontosBase).toBe(Math.trunc((56367 * 10000) / 100000));
    expect(dre.grupos.map((g) => g.grupo)).toEqual(["Receitas operacionais", "Custos operacionais", "Juros, multas e descontos"]);
    expect(dre.grupos[2]!.totalCentavos).toBe(300);
    const fln = dre.porPracaLinha.find((x) => x.unidadeId === "fln")!;
    expect(fln.despesaCentavos).toBe(43633);
    expect(dre.porPracaLinha.reduce((s, x) => s + x.resultadoCentavos, 0)).toBe(dre.resultadoCentavos);
  });
});

describe("fatura do cartão", () => {
  it("compra até o fechamento cai na fatura do mês; depois, na do seguinte", () => {
    expect(faturaDaData("2026-10-10", 15, 25)).toEqual({ referencia: "2026-10", fechamento: "2026-10-15", vencimento: "2026-10-25" });
    expect(faturaDaData("2026-10-15", 15, 25).referencia).toBe("2026-10");
    expect(faturaDaData("2026-10-16", 15, 25)).toEqual({ referencia: "2026-11", fechamento: "2026-11-15", vencimento: "2026-11-25" });
  });
  it("vencimento antes do fechamento vai para o mês seguinte; fim de mês curto usa o último dia", () => {
    expect(faturaDaData("2026-12-20", 25, 5)).toEqual({ referencia: "2026-12", fechamento: "2026-12-25", vencimento: "2027-01-05" });
    expect(faturaDaData("2026-02-10", 31, 10)).toEqual({ referencia: "2026-02", fechamento: "2026-02-28", vencimento: "2026-03-10" });
  });
});

describe("regressões da revisão", () => {
  it("sinal do valor só no início ou no fim; hífen no meio invalida", () => {
    expect(paraCentavos("R$-10,00")).toBe(-1000);
    expect(paraCentavos("-R$ 10,00")).toBe(-1000);
    expect(paraCentavos("R$ -10,00")).toBe(-1000);
    expect(paraCentavos("10,00-")).toBe(-1000);
    expect(paraCentavos("+5")).toBe(500);
    expect(paraCentavos("2026-10-03")).toBeNull();
    expect(paraCentavos("1-0")).toBeNull();
    expect(paraCentavos("--5")).toBeNull();
    expect(paraCentavos("-10,00-")).toBeNull();
  });

  it("OFX: valor com ponto decimal; milhar com ponto é recusado, não multiplicado", () => {
    const base = (v: string) => `<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20261003<TRNAMT>${v}<FITID>X1<MEMO>teste\n</STMTTRN></BANKTRANLIST></OFX>`;
    expect(lerOfx(base("-1234.56")).linhas[0]!.valorCentavos).toBe(-123456);
    expect(lerOfx(base("-1234,56")).linhas[0]!.valorCentavos).toBe(-123456);
    const r = lerOfx(base("-100.000"));
    expect(r.linhas).toHaveLength(0);
    expect(r.ignoradas[0]!.motivo).toBe("Valor inválido.");
  });

  it("fatura de cartão: só inverte o sinal da coluna Valor única, não de Crédito/Débito", () => {
    const r = lerCsvExtrato("Data;Descrição;Crédito;Débito\n10/10/2026;Estorno;20,00;\n11/10/2026;Posto;;150,00\n", { faturaCartao: true });
    expect(r.linhas.map((l) => l.valorCentavos)).toEqual([2000, -15000]);
  });

  it("CSV: separador vem do cabeçalho e a descrição nunca é a coluna de data", () => {
    const csv = "Extrato, conta corrente, banco x\nPeríodo: 01/10, a 31/10\nData Lançamento;Histórico;Valor\n03/10/2026;Pedágio;-12,50\n";
    const r = lerCsvExtrato(csv);
    expect(r.linhas).toEqual([{ fitid: null, data: "2026-10-03", valorCentavos: -1250, descricao: "Pedágio", documento: null }]);
    const r2 = lerCsvExtrato("Data Lançamento;Lançamento;Valor\n03/10/2026;Posto Teste;-10,00\n");
    expect(r2.linhas[0]!.descricao).toBe("Posto Teste");
    expect(() => lerCsvExtrato("Data Lançamento;Valor\n03/10/2026;-10,00\n")).toThrow(/descrição/);
  });

  it("vencimento da fatura sempre depois do fechamento", () => {
    const f = faturaDaData("2026-02-10", 28, 31);
    expect(f.fechamento).toBe("2026-02-28");
    expect(f.vencimento).toBe("2026-03-31");
    for (const [fech, venc] of [[28, 31], [31, 31], [30, 31], [15, 15], [31, 28]] as const) {
      for (const d of ["2026-01-05", "2026-02-10", "2026-02-27", "2026-04-30", "2028-02-29"]) {
        const x = faturaDaData(d, fech, venc);
        expect(x.vencimento > x.fechamento, `${d} ${fech}/${venc}`).toBe(true);
      }
    }
  });
});

describe("planilha de controle financeiro", () => {
  const csv = [
    "RESUMO,x,,,,,,,,,,,", "RECEITA SIC,\"R$  1,00\",,,,,,,,,,,",
    "MÊS,CONTA,DATA,,CAT,FORNECEDOR,DESCRIÇÃO, A PAGAR , SICREDI , UNILOS , QUIOSQUE , CARTÃO ,OBS",
    "OUT,,,,AAA SALDO,,,,\" R$  10.000,00 \",\" R$  5.000,00 \",,,",
    "OUT,SIC,05/10/2026,FOTA,MANUTENÇÃO,Oficina X,Revisão,,\" R$  (1.500,00) \",,,,CNPJ 12.345.678/0001-95 a@b.example",
    "OUT,,10/10/2026,FIXO,CONSORCIO,Consórcio,Parcela,\" R$  (900,00) \",,,,,",
    ",,,,TOTAL,,,\" R$  - \",\" R$  1.234,56 \",,,,",
    "OUT,SIC,xx,FROTA,POSTO,P,Y,,\" R$  (10,00) \",,,,",
    "OUT,SIC,11/10/2026,FROTA,POSTO,P,Y,,\" R$  abc \",,,,",
  ].join("\n");

  it("localiza o cabeçalho, ignora o resumo do topo e lê negativos entre parênteses e o saldo", () => {
    const r = lerPlanilhaFinanceira(csv);
    expect(r.cabecalhoLinha).toBe(3);
    expect(r.linhas.map((l) => [l.saldo, l.data, l.grupo, l.categoria, l.valores])).toEqual([
      [true, null, "", "AAA SALDO", { SICREDI: 1000000, UNILOS: 500000 }],
      [false, "2026-10-05", "FOTA", "MANUTENÇÃO", { SICREDI: -150000 }],
      [false, "2026-10-10", "FIXO", "CONSORCIO", { APAGAR: -90000 }],
    ]);
    expect(r.layout).toBe("NOVO");
    expect(r.ignoradas.some((i) => /total/i.test(i.motivo))).toBe(true);
    expect(r.datasInvalidas).toEqual([{ linha: 8, texto: "xx" }]);
    expect(r.erros).toHaveLength(1);
    expect(() => lerPlanilhaFinanceira("a,b\n1,2")).toThrow(/Cabeçalho/);
  });

  it("layout antigo: SAÍDA SIC e ENTR SIC positivos viram o saldo líquido do Sicredi; AGE e totais são ignorados", () => {
    const antigo = [
      "x,,,,,,,,,", "MÊS,CONTA,DATA,,CAT,FORNECEDOR,DESCRIÇÃO, A PAGAR , SAIDA SIC , ENTR SIC , CARTÃO , UNILOS ,OBS",
      "AGO,SIC,05/08/2026,FROTA,MANUTENÇÃO,Oficina,Revisão,,\" R$  1.500,00 \",,,,",
      "AGO,SIC,06/08/2026,RECEITA,CLIENTE,Cliente,Fretamento,,,\" R$  3.000,00 \",,,",
      "AGO,UNI,07/08/2026,RH,FOLHA,,Folha,,,,,\" R$  (800,00) \",",
      "AGO,AGE,08/08/2026,,LEMBRETE,,Ligar,,,,,,",
      "AGO,SIC,03/06,FROTA,POSTO,P,Y,,\" R$  10,00 \",,,,",
    ].join("\n");
    const r = lerPlanilhaFinanceira(antigo);
    expect(r.layout).toBe("ANTIGO");
    expect(r.linhas.map((l) => l.valores)).toEqual([{ SICREDI: -150000 }, { SICREDI: 300000 }, { UNILOS: -80000 }]);
    expect(r.datasInvalidas).toEqual([{ linha: 7, texto: "03/06" }]);
    expect(r.ignoradas.some((i) => /Agenda/.test(i.motivo))).toBe(false); // AGE sem valor: linha vazia, nem chega a ser lançamento
  });

  it("valores da planilha", () => {
    expect(valorPlanilha(" R$  1.234,56 ")).toBe(123456);
    expect(valorPlanilha("R$  (1.000,00)")).toBe(-100000);
    expect(valorPlanilha(" R$ - ")).toBeUndefined();
    expect(valorPlanilha("")).toBeUndefined();
    expect(valorPlanilha("R$ abc")).toBeNull();
  });

  it("sinônimos: erros de digitação e variações caem na categoria certa", () => {
    const d = montarDicionario(SINONIMOS_PADRAO);
    const alvo = (g: string, c: string) => classificar(g, c, d).alvo;
    expect(alvo("FOTA", "MANUTENÇÃO")).toBe("DESP_MANUTENCAO");
    expect(alvo(" FROTA ", "manutencao")).toBe("DESP_MANUTENCAO");
    expect(alvo("RECEIRA", "CLIENTE - EMITIR NF")).toBe("REC_CLIENTE");
    expect(alvo("RH - BC", "FOLHA CLT")).toBe("DESP_FOLHA_CLT");
    expect(alvo("PESS", "DESP DIRETA")).toBe("DESP_PESSOAL");
    expect(alvo("PESSOAL", "qualquer coisa")).toBe("DESP_PESSOAL");
    expect(alvo("IMPOSTO", "DAS")).toBe("DESP_IMPOSTOS");
    expect(alvo("TAXA", "TAXAS")).toBe("DESP_TAXAS");
    expect(alvo("ADM", "TRANS ENTRE CONTAS")).toBe("@TRANSFERENCIA");
    expect(alvo("ADM", "DEVOLUÇÃO")).toBe("DESP_DEVOLUCAO");
    expect(alvo("RECEITA", "DEVOLUÇÃO")).toBe("REC_DEVOLUCAO");
    expect(alvo("FIXO", "RASTREADOR")).toBe("DESP_RASTREADOR");
    expect(alvo("QUIO", "DESPESA")).toBe("DESP_QUIOSQUE");
    expect(alvo("AGENDA", "LEMBRETE")).toBeNull();
    expect(alvo("ADM", "TRANF ENTRE CONTAS")).toBe("@TRANSFERENCIA");
    expect(alvo("ADM", "APLICAÇÃO")).toBe("@APLICACAO");
    expect(alvo("RECEITA", "RESGATE")).toBe("@APLICACAO");
    expect(alvo("FIXO", "EPRESTIMO")).toBe("DESP_EMPRESTIMO");
    expect(alvo("ADM", "Capital de Giro")).toBe("DESP_EMPRESTIMO");
    expect(alvo("RH", "COMISSÃO BETO CARREIRO")).toBe("DESP_COMISSAO_RH");
    expect(classificar("AGENDA", "LEMBRETE", d).chave).toBe("AGENDA|LEMBRETE");
  });

  it("OBS: CPF, CNPJ, e-mail e telefone saem do texto", () => {
    const r = separarObs("PIX CNPJ 12.345.678/0001-95 contato@teste.example fone 48 99999-1234 pago adiantado");
    expect(r.documentos).toEqual(["12.345.678/0001-95"]);
    expect(r.emails).toEqual(["contato@teste.example"]);
    expect(r.telefones).toHaveLength(1);
    expect(r.texto).toBe("pago adiantado");
    expect(separarObs("CPF 123.456.789-09").texto).toBe("");
    expect(separarObs("").documentos).toEqual([]);
  });

  it("placa do veículo no texto", () => {
    expect(extrairPlaca("Revisão qjq2a16")).toBe("QJQ2A16");
    expect(extrairPlaca("Diesel ABC-1234")).toBe("ABC1234");
    expect(extrairPlaca("sem placa")).toBeNull();
  });

  it("DRE: despesa pessoal fica fora do resultado operacional e aparece à parte", () => {
    const cats = new Map([
      ["r", { nome: "Clientes", tipo: "RECEITA" as const, grupo: "Receita", ordem: 1 }],
      ["f", { nome: "Manutenção", tipo: "DESPESA" as const, grupo: "Frota", ordem: 2 }],
      ["p", { nome: "Despesa direta", tipo: "DESPESA" as const, grupo: GRUPO_PESSOAL, ordem: 3 }],
    ]);
    const base = { situacao: "ABERTO" as const, valorPagoCentavos: null, jurosCentavos: 0, multaCentavos: 0, descontoCentavos: 0, vencimento: "2026-10-01", pagoEm: null, unidadeId: null, linha: null };
    const dre = montarDre([
      { ...base, tipo: "RECEBER", categoriaId: "r", valorCentavos: 100000 },
      { ...base, tipo: "PAGAR", categoriaId: "f", valorCentavos: 30000 },
      { ...base, tipo: "PAGAR", categoriaId: "p", valorCentavos: 15000 },
    ], cats);
    expect(dre.resultadoCentavos).toBe(70000);
    expect(dre.despesaCentavos).toBe(30000);
    expect(dre.grupos.some((g) => g.grupo === GRUPO_PESSOAL)).toBe(false);
    expect(dre.pessoalCentavos).toBe(15000);
    expect(dre.pessoal?.categorias).toEqual([{ categoriaId: "p", nome: "Despesa direta", totalCentavos: 15000 }]);
    expect(dre.resultadoAposPessoalCentavos).toBe(55000);
  });
});
