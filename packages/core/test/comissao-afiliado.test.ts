import { describe, expect, it } from "vitest";
import { dataPagamentoComissao, periodoDoPagamento, proximoPagamento, ratearComissao, situacaoComissao } from "../src/index.js";

describe("comissão de afiliados (13/11/2026)", () => {
  it("pagamento quinzenal pela data do passeio (exemplos do dono)", () => {
    expect(dataPagamentoComissao("2026-04-26")).toBe("2026-05-01"); // compra 02/03, passeio 26/04 → 01/05
    expect(dataPagamentoComissao("2026-05-02")).toBe("2026-05-16"); // compra 23/04, passeio 02/05 → 16/05
    expect(dataPagamentoComissao("2026-05-15")).toBe("2026-05-16");
    expect(dataPagamentoComissao("2026-12-31")).toBe("2027-01-01");
    expect(periodoDoPagamento("2026-05-01")).toEqual({ de: "2026-04-16", ate: "2026-04-30" });
    expect(periodoDoPagamento("2026-03-01")).toEqual({ de: "2026-02-16", ate: "2026-02-28" });
    expect(periodoDoPagamento("2027-01-01")).toEqual({ de: "2026-12-16", ate: "2026-12-31" });
    expect(periodoDoPagamento("2026-05-16")).toEqual({ de: "2026-05-01", ate: "2026-05-15" });
    expect(() => periodoDoPagamento("2026-05-10")).toThrow();
    expect(proximoPagamento("2026-11-13")).toBe("2026-11-16");
    expect(proximoPagamento("2026-11-20")).toBe("2026-12-01");
    expect(proximoPagamento("2026-12-16")).toBe("2026-12-16");
  });

  it("divide a comissão do pedido entre as reservas sem perder centavos", () => {
    expect(ratearComissao(1000, [30000, 10000])).toEqual([750, 250]);
    expect(ratearComissao(1001, [1, 1, 1])).toEqual([334, 334, 333]);
    expect(ratearComissao(500, [0, 0])).toEqual([250, 250]);
    expect(ratearComissao(0, [100])).toEqual([0]);
  });

  it("só vale depois do passeio realizado; não compareceu ou cancelada não gera comissão", () => {
    const base = { reservaCancelada: false, dataPasseio: "2026-11-10", hoje: "2026-11-13", compareceu: true, paga: false };
    expect(situacaoComissao(base)).toBe("A_PAGAR");
    expect(situacaoComissao({ ...base, compareceu: null })).toBe("A_PAGAR");
    expect(situacaoComissao({ ...base, compareceu: false })).toBe("CANCELADA");
    expect(situacaoComissao({ ...base, reservaCancelada: true })).toBe("CANCELADA");
    expect(situacaoComissao({ ...base, dataPasseio: "2026-11-13" })).toBe("PREVISTA");
    expect(situacaoComissao({ ...base, paga: true })).toBe("PAGA");
  });
});
