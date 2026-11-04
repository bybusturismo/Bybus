import { describe, expect, it } from "vitest";
import { centavosDeTexto, formatarMoeda, nomeMes, somarMes, textoDeCentavos, ultimoDiaDoMes } from "../../util/formato";
import { decodificarArquivo, formatarMargem } from "./util";

describe("dinheiro na tela (helpers comuns)", () => {
  it("lê valores em reais como centavos inteiros, sem arredondar", () => {
    expect(centavosDeTexto("1.234,56")).toBe(123456);
    expect(centavosDeTexto("1234,5")).toBe(123450);
    expect(centavosDeTexto("1234.56")).toBe(123456);
    expect(centavosDeTexto("300.50")).toBe(30050);
    expect(centavosDeTexto("R$ 10")).toBe(1000);
    expect(centavosDeTexto("1.234")).toBe(123400);
    expect(centavosDeTexto("0,07")).toBe(7);
    expect(centavosDeTexto("")).toBeNull();
  });

  it("aceita negativo (saldo inicial negativo) e devolve ao campo sem estragar o sinal", () => {
    expect(centavosDeTexto("-1.234,56")).toBe(-123456);
    expect(centavosDeTexto("R$ -10")).toBe(-1000);
    expect(centavosDeTexto("-R$ 10,50")).toBe(-1050);
    expect(textoDeCentavos(-15150)).toBe("-151,50");
    expect(centavosDeTexto(textoDeCentavos(-15150))).toBe(-15150);
    expect(centavosDeTexto(textoDeCentavos(-5))).toBe(-5);
    expect(centavosDeTexto(textoDeCentavos(123456))).toBe(123456);
  });

  it("recusa o que não é valor ou tem mais de duas casas", () => {
    for (const ruim of ["abc", "12,345", "1,2,3", "1.2.3", "10,5x", "--5", "5-"]) expect(centavosDeTexto(ruim), ruim).toBeNaN();
  });

  it("formata moeda, margem e meses", () => {
    expect(formatarMoeda(123456)).toBe("R$ 1.234,56");
    expect(formatarMargem(1234)).toBe("12,34%");
    expect(formatarMargem(null)).toBe("—");
    expect(nomeMes("2026-11")).toBe("Novembro de 2026");
    expect(somarMes("2026-12", 1)).toBe("2027-01");
    expect(ultimoDiaDoMes("2028-02")).toBe("2028-02-29");
  });

  it("decodifica UTF-8 e cai para Windows-1252 (OFX de bancos brasileiros)", () => {
    expect(decodificarArquivo(new TextEncoder().encode("Pão de Açúcar").buffer as ArrayBuffer)).toBe("Pão de Açúcar");
    expect(decodificarArquivo(new Uint8Array([0x50, 0xe3, 0x6f]).buffer as ArrayBuffer)).toBe("Pão");
  });
});
