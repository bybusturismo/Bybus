import { describe, expect, it } from "vitest";
import { canalReal, codigoAfiliadoValido, indicadoresCampanha, linkAfiliado, mediaNotas, normalizarCodigoAfiliado, percentuais, renderizarModeloAvaliacao } from "../src/index.js";

describe("marketing", () => {
  it("canal real prefere o canal de origem (reserva espelho)", () => {
    expect(canalReal("PAYTOUR", "VIATOR")).toBe("VIATOR");
    expect(canalReal("PAYTOUR", null)).toBe("PAYTOUR");
  });

  it("percentuais somam exatamente 100", () => {
    const p = percentuais([1, 1, 1]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentuais([0, 0])).toEqual([0, 0]);
    expect(percentuais([3, 1])).toEqual([75, 25]);
  });

  it("campanha sem resultado lançado não tem retorno", () => {
    const i = indicadoresCampanha({ investimentoCentavos: 100000, metaReservas: 50, resultados: [] });
    expect(i).toEqual({ temAtribuicao: false, custoPorReservaCentavos: null, custoPorPassageiroCentavos: null, retorno: null, atingimentoMeta: null });
  });

  it("campanha com resultados calcula custo e retorno em centavos", () => {
    const i = indicadoresCampanha({
      investimentoCentavos: 100000,
      metaReservas: 40,
      resultados: [{ reservas: 10, passageiros: 25, receitaCentavos: 200000 }, { reservas: 10, passageiros: 25, receitaCentavos: 150000 }],
    });
    expect(i.custoPorReservaCentavos).toBe(5000);
    expect(i.custoPorPassageiroCentavos).toBe(2000);
    expect(i.retorno).toBe(3.5);
    expect(i.atingimentoMeta).toBe(0.5);
  });

  it("retorno fica nulo quando nenhum resultado informou receita", () => {
    const i = indicadoresCampanha({ investimentoCentavos: 5000, resultados: [{ reservas: 2, passageiros: 4, receitaCentavos: null }] });
    expect(i.retorno).toBeNull();
    expect(i.custoPorReservaCentavos).toBe(2500);
  });

  it("código de afiliado", () => {
    expect(normalizarCodigoAfiliado(" hotel mar ")).toBe("HOTEL-MAR");
    expect(codigoAfiliadoValido("HOTEL-MAR")).toBe(true);
    expect(codigoAfiliadoValido("AB")).toBe(false);
    expect(codigoAfiliadoValido("-ABC")).toBe(false);
    expect(codigoAfiliadoValido("ABC DEF")).toBe(false);
    expect(linkAfiliado("https://loja.exemplo.test/", "HOTEL-MAR")).toBe("https://loja.exemplo.test/?ref=HOTEL-MAR");
  });

  it("modelo de avaliação usa só o primeiro nome e mantém variável desconhecida", () => {
    const t = renderizarModeloAvaliacao("Oi {nome}, {passeio} em {data} {xyz} {linkTripadvisor}", { nome: "Maria Exemplo Silva", passeio: "City Tour", data: "05/11", linkTripadvisor: "https://t.test/a" });
    expect(t).toBe("Oi Maria, City Tour em 05/11 {xyz} https://t.test/a");
  });

  it("média das notas", () => {
    expect(mediaNotas([])).toBeNull();
    expect(mediaNotas([5, 4, 4])).toBe(4.33);
  });
});
