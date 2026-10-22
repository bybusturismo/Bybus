import { describe, expect, it } from "vitest";
import { cpfValido, mascararCpf, validarDocumento } from "./documento";

describe("CPF no cliente", () => {
  it("aplica máscara progressiva", () => {
    expect(mascararCpf("529")).toBe("529");
    expect(mascararCpf("5299822")).toBe("529.982.2");
    expect(mascararCpf("52998224725999")).toBe("529.982.247-25");
  });
  it("valida dígitos verificadores", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("111.222.333-00")).toBe(false);
    expect(cpfValido("000.000.000-00")).toBe(false);
  });
  it("mensagens por tipo", () => {
    expect(validarDocumento("CPF", "123")).toMatch(/11 dígitos/);
    expect(validarDocumento("CPF", "111.222.333-00")).toMatch(/inválido/);
    expect(validarDocumento("PASSAPORTE", "X1")).toMatch(/curto/);
    expect(validarDocumento(null, "123456")).toMatch(/tipo/);
    expect(validarDocumento("CPF", "")).toBeNull();
  });
});
