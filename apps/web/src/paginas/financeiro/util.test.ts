import { describe, expect, it } from "vitest";
import { centavosParaCampo, decodificarArquivo, formatarMargem, formatarReais, lerReais, nomeMes, somarMesAno, ultimoDiaDoMes } from "./util";

describe("dinheiro na tela", () => {
  it("lê valores em reais como centavos inteiros, sem arredondar", () => {
    expect(lerReais("1.234,56")).toBe(123456);
    expect(lerReais("1234,5")).toBe(123450);
    expect(lerReais("1234.56")).toBe(123456);
    expect(lerReais("R$ 10")).toBe(1000);
    expect(lerReais("1.234")).toBe(123400);
    expect(lerReais("0,07")).toBe(7);
    expect(lerReais("19,99")).toBe(1999);
  });

  it("recusa o que não é valor, negativo ou com mais de duas casas", () => {
    for (const ruim of ["", "abc", "-5", "12,345", "1,2,3", "1.2.3", "10,5x"]) expect(lerReais(ruim), ruim).toBeNull();
  });

  it("formata e devolve ao campo", () => {
    expect(formatarReais(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
    expect(centavosParaCampo(5)).toBe("0,05");
    expect(lerReais(centavosParaCampo(123456))).toBe(123456);
    expect(formatarMargem(1234)).toBe("12,34%");
    expect(formatarMargem(null)).toBe("—");
  });

  it("meses", () => {
    expect(nomeMes("2026-11")).toBe("Novembro de 2026");
    expect(somarMesAno("2026-12", 1)).toBe("2027-01");
    expect(ultimoDiaDoMes("2028-02")).toBe("2028-02-29");
  });

  it("decodifica UTF-8 e cai para Windows-1252 (OFX de bancos brasileiros)", () => {
    expect(decodificarArquivo(new TextEncoder().encode("Pão de Açúcar").buffer as ArrayBuffer)).toBe("Pão de Açúcar");
    expect(decodificarArquivo(new Uint8Array([0x50, 0xe3, 0x6f]).buffer as ArrayBuffer)).toBe("Pão");
  });
});
