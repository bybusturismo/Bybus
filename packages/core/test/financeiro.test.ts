import { describe, expect, it } from "vitest";
import {
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
