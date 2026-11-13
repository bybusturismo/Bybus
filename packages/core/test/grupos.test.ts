import { describe, expect, it } from "vitest";
import { planoDeCobranca, totalDoGrupo, valorPorExtenso } from "../src/index.js";

describe("grupos fechados (13/11/2026)", () => {
  it("total respeita o mínimo de pessoas", () => {
    expect(totalDoGrupo({ valorPorPessoaCentavos: 13000, pessoas: 30, pessoasMinimo: 25 })).toBe(390000);
    expect(totalDoGrupo({ valorPorPessoaCentavos: 13000, pessoas: 20, pessoasMinimo: 25 })).toBe(325000);
    expect(totalDoGrupo({ valorPorPessoaCentavos: null, pessoas: 20, pessoasMinimo: null })).toBeNull();
  });

  it("plano de cobrança: sinal de 50% e saldo no dia do passeio (exemplo do contrato do dono)", () => {
    expect(planoDeCobranca({ totalCentavos: 325000, sinalPercentual: 50, vencimentoSinal: "2026-10-05", dataPasseio: "2026-10-29" })).toEqual([
      { tipo: "SINAL", descricao: "Sinal (50%) para reservar a data", valorCentavos: 162500, vencimento: "2026-10-05" },
      { tipo: "SALDO", descricao: "Saldo até o dia do passeio", valorCentavos: 162500, vencimento: "2026-10-29" },
    ]);
    expect(planoDeCobranca({ totalCentavos: 1001, sinalPercentual: 30, vencimentoSinal: "2026-10-05", dataPasseio: "2026-10-29" }).map((p) => p.valorCentavos)).toEqual([300, 701]);
    expect(planoDeCobranca({ totalCentavos: 1000, sinalPercentual: 100, vencimentoSinal: "2026-10-05", dataPasseio: "2026-10-29" })).toHaveLength(1);
    expect(planoDeCobranca({ totalCentavos: 0, sinalPercentual: 50, vencimentoSinal: "2026-10-05", dataPasseio: null })).toEqual([]);
  });

  it("valor por extenso (contrato e recibo)", () => {
    expect(valorPorExtenso(13000)).toBe("cento e trinta reais");
    expect(valorPorExtenso(325000)).toBe("três mil duzentos e cinquenta reais");
    expect(valorPorExtenso(162500)).toBe("mil seiscentos e vinte e cinco reais");
    expect(valorPorExtenso(100)).toBe("um real");
    expect(valorPorExtenso(2205)).toBe("vinte e dois reais e cinco centavos");
    expect(valorPorExtenso(120000)).toBe("mil e duzentos reais");
    expect(valorPorExtenso(205000)).toBe("dois mil e cinquenta reais");
    expect(valorPorExtenso(10000000)).toBe("cem mil reais");
    expect(valorPorExtenso(100000000)).toBe("um milhão de reais");
    expect(valorPorExtenso(45)).toBe("quarenta e cinco centavos");
  });
});
