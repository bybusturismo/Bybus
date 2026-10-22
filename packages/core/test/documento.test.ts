import { describe, expect, it } from "vitest";
import { canalPorDocumentoFicticio, cpfValido, documentoValido, formatarCpf, mascararDocumento } from "../src/index.js";

describe("CPF", () => {
  it("aceita CPF válido com e sem máscara", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("52998224725")).toBe(true);
  });
  it("rejeita dígito errado, tamanho errado e repetidos", () => {
    expect(cpfValido("529.982.247-24")).toBe(false);
    expect(cpfValido("1234567890")).toBe(false);
    expect(cpfValido("111.111.111-11")).toBe(false);
  });
  it("formata e mascara", () => {
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
    expect(mascararDocumento("529.982.247-25")).toBe("•••4725");
    expect(mascararDocumento("AB1")).toBe("••••");
  });
  it("valida passaporte por tamanho mínimo", () => {
    expect(documentoValido("PASSAPORTE", "X1234567")).toBe(true);
    expect(documentoValido("PASSAPORTE", "X12")).toBe(false);
  });
  it("reconhece documentos fictícios das OTAs", () => {
    expect(canalPorDocumentoFicticio("1111")).toBe("VIATOR");
    expect(canalPorDocumentoFicticio("2222")).toBe("DECOLAR");
    expect(canalPorDocumentoFicticio("3333")).toBe("CIVITATIS");
    expect(canalPorDocumentoFicticio("52998224725")).toBeNull();
  });
});
