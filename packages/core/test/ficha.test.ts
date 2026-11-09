import { describe, expect, it } from "vitest";
import { cnpjValido, idade, normalizarFichaSensivel, tipoDoArquivo } from "../src/index.js";

describe("ficha do usuário", () => {
  it("valida CPF e CNPJ e limpa os campos", () => {
    const f = normalizarFichaSensivel({ cpf: "529.982.247-25", cnpj: "11.222.333/0001-81", endereco: { cep: "88058-500", uf: "sc", cidade: " Florianópolis " }, pix: { chave: "chave-ficticia" }, emergencia: { nome: "Contato Fictício", telefone: "(48) 90000-0000" } });
    expect(f).toMatchObject({ cpf: "52998224725", cnpj: "11222333000181", endereco: { cep: "88058500", uf: "SC", cidade: "Florianópolis" }, pix: { tipo: "ALEATORIA", chave: "chave-ficticia" } });
    expect(() => normalizarFichaSensivel({ cpf: "111.111.111-11" })).toThrow("CPF inválido");
    expect(() => normalizarFichaSensivel({ cnpj: "11.222.333/0001-00" })).toThrow("CNPJ inválido");
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
  });
  it("idade e tipo do anexo pelos primeiros bytes", () => {
    expect(idade("1990-11-10", "2026-11-09")).toBe(35);
    expect(idade("1990-11-09", "2026-11-09")).toBe(36);
    expect(tipoDoArquivo(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe("application/pdf");
    expect(tipoDoArquivo(new Uint8Array([0x4d, 0x5a]))).toBeNull();
  });
});
