import { describe, expect, it } from "vitest";
import { anonimizarReserva, cpfFicticio, cpfValido, type ReservaImportada } from "../src/index.js";

// Reserva com dados FICTÍCIOS simulando dados pessoais.
const reserva: ReservaImportada = {
  canal: "PAYTOUR", codigoExterno: "PT-123", referencias: ["X1"], data: "2026-11-02", horario: "08:00",
  produto: "City Tour Toda Ilha", contatoNome: "Fulano de Tal", contatoTelefone: "+55 48 99999-0000", contatoEmail: "fulano@exemplo.com",
  pontoEmbarqueTexto: "Hotel Majestic", cancelada: false, observacoes: "Hotel X quarto 12",
  passageiros: [
    { nome: "Fulano de Tal", categoria: "ADULTO", documentoTipo: "CPF", documento: "529.982.247-25" },
    { nome: "Beltrana", categoria: "INFANTIL", documentoTipo: "PASSAPORTE", documento: "AB123456" },
    { nome: "Ciclano", categoria: "ADULTO", documentoTipo: "OUTRO", documento: "2222" },
  ],
  avisos: [],
};

describe("anonimizarReserva", () => {
  it("troca dados pessoais e mantém o que a operação precisa", () => {
    const a = anonimizarReserva(reserva);
    const texto = JSON.stringify(a);
    for (const pessoal of ["Fulano", "Beltrana", "Ciclano", "99999", "fulano@", "529", "AB123456", "quarto"]) expect(texto).not.toContain(pessoal);
    expect(a).toMatchObject({ canal: "PAYTOUR", codigoExterno: "PT-123", data: "2026-11-02", produto: "City Tour Toda Ilha", pontoEmbarqueTexto: "Hotel Majestic" });
    expect(a.passageiros.map((p) => p.categoria)).toEqual(["ADULTO", "INFANTIL", "ADULTO"]);
    expect(cpfValido(a.passageiros[0]!.documento!)).toBe(true);
    expect(a.passageiros[2]!.documento).toBe("2222"); // documento fictício de OTA indica o canal e fica
    expect(a.contatoEmail).toMatch(/@exemplo\.invalid$/);
  });

  it("é determinística (reimportar não muda os nomes)", () => {
    expect(anonimizarReserva(reserva)).toEqual(anonimizarReserva(reserva));
    expect(cpfFicticio("a")).not.toBe(cpfFicticio("b"));
  });
});
