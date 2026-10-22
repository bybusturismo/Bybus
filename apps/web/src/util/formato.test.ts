import { describe, expect, it } from "vitest";
import { diferencaDias, formatarData, formatarDataExtenso, formatarDataHora, formatarMoeda, hojeIso, intervaloDias, somarDias } from "./formato";

describe("formatação pt-BR", () => {
  it("datas civis em dd/mm/aaaa e por extenso, sem trocar o dia por fuso", () => {
    expect(formatarData("2026-10-23")).toBe("23/10/2026");
    expect(formatarDataExtenso("2026-10-23")).toBe("Sexta-feira, 23 de outubro de 2026");
    expect(formatarDataExtenso("2027-01-01")).toBe("Sexta-feira, 1 de janeiro de 2027");
  });

  it("instante UTC exibido no horário de Brasília", () => {
    expect(formatarDataHora("2026-10-23T02:30:00Z")).toBe("22/10/2026 23:30");
  });

  it("hoje considera America/Sao_Paulo (00h30 UTC ainda é o dia anterior)", () => {
    expect(hojeIso(new Date("2026-10-23T00:30:00Z"))).toBe("2026-10-22");
  });

  it("aritmética de dias", () => {
    expect(somarDias("2026-10-31", 1)).toBe("2026-11-01");
    expect(intervaloDias("2026-12-30", 3)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(diferencaDias("2026-10-22", "2026-10-23")).toBe(1);
  });

  it("moeda em centavos → R$ 1.234,56", () => {
    expect(formatarMoeda(123456)).toBe("R$ 1.234,56");
  });
});
