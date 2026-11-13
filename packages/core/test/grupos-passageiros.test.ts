import { describe, expect, it } from "vitest";
import { contarPorCategoria, dataDaPlanilha, lerPlanilhaPassageiros, normalizarPassageiro } from "../src/index.js";

// CPF fictício válido (gerado só para teste).
const CPF = "529.982.247-25";

describe("lista de passageiros do grupo (13/11/2026)", () => {
  it("lê a planilha com cabeçalho em qualquer ordem, ignora linhas vazias e aponta erros", () => {
    const r = lerPlanilhaPassageiros([
      ["Lista da turma fictícia"],
      ["Nº", "Data de nascimento", "Nome completo", "Função", "Documento"],
      ["1", "10/05/2014", "Aluno Fictício Um", "Aluno", CPF],
      ["2", "", "Professora Fictícia", "Professora", "1.234.567 SSP/SC"],
      ["", "", "", "", ""],
      ["3", "31/13/2014", "Aluno Fictício Dois", "", ""],
      ["4", "", "Jo", "", ""],
      ["5", "", "Aluno CPF Errado", "", "111.111.111-11"],
    ]);
    expect(r.passageiros).toEqual([
      { nome: "Aluno Fictício Um", tipoDocumento: "CPF", documento: "52998224725", nascimento: "2014-05-10", categoria: "ALUNO" },
      { nome: "Professora Fictícia", tipoDocumento: "RG", documento: "1.234.567 SSP/SC", nascimento: null, categoria: "PROFESSOR" },
    ]);
    expect(r.erros).toEqual([{ linha: 6, motivo: "data de nascimento inválida" }, { linha: 7, motivo: "nome muito curto" }, { linha: 8, motivo: "CPF inválido" }]);
    expect(contarPorCategoria(r.passageiros)).toMatchObject({ ALUNO: 1, PROFESSOR: 1 });
  });

  it("sem cabeçalho: 1ª coluna nome, 2ª documento", () => {
    expect(lerPlanilhaPassageiros([["Maria Fictícia", "123456"]]).passageiros[0]).toMatchObject({ nome: "Maria Fictícia", documento: "123456", tipoDocumento: "RG" });
  });

  it("datas e campos vindos da tela", () => {
    expect(dataDaPlanilha("5/3/14")).toBe("2014-03-05");
    expect(dataDaPlanilha("2014-03-05T00:00:00")).toBe("2014-03-05");
    expect(normalizarPassageiro({ nome: "  Ana   Fictícia ", tipoDocumento: "PASSAPORTE", documento: " AB123 ", categoria: "ACOMPANHANTE" })).toEqual({ nome: "Ana Fictícia", tipoDocumento: "PASSAPORTE", documento: "AB123", nascimento: null, categoria: "ACOMPANHANTE" });
  });
});
