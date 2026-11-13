import { describe, expect, it } from "vitest";
import { pareceTransferencia, suspeitosDaDiferenca, type MovimentoConferencia } from "../src/index.js";

const m = (id: string, data: string, valor: number, descricao: string, extra: Partial<MovimentoConferencia> = {}): MovimentoConferencia =>
  ({ id, origem: "LANCAMENTO", data, valorCentavos: valor, descricao, transferencia: false, criadoPelaPlanilha: false, ...extra });

describe("conferência de saldo (13/11/2026)", () => {
  it("reconhece transferência, aplicação e resgate pela descrição", () => {
    for (const t of ["TRANSF ENTRE CONTAS", "Transferência p/ Unilos", "APLICAÇÃO", "Resgate poupança", "TED mesma titularidade"]) expect(pareceTransferencia(t), t).toBe(true);
    // "transfer" é o serviço de busca no hotel (receita): não é transferência bancária.
    for (const t of ["CLIENTE - CONTRATO", "Combustível", "Taxa do transfer", "TRANSFER HOTEL"]) expect(pareceTransferencia(t), t).toBe(false);
  });

  it("aponta a transferência lançada em dobro e o valor igual à diferença, antes dos demais", () => {
    const movs = [
      m("planilha", "2026-11-03", 2500000, "TRANSF ENTRE CONTAS", { origem: "LINHA", transferencia: true, criadoPelaPlanilha: true }),
      m("mao", "2026-11-05", 2500000, "TRANSF ENTRE CONTAS"),
      m("combustivel", "2026-11-06", -30000, "Combustível"),
      m("estranho", "2026-11-07", 53994, "Recebimento"),
      m("r1", "2026-11-12", 18621, "RECEITA"), m("r2", "2026-11-12", 18621, "RECEITA"),
    ];
    const s = suspeitosDaDiferenca(movs, 53994);
    expect(s[0]).toMatchObject({ id: "estranho", motivos: ["VALOR_DA_DIFERENCA"] });
    expect(s[1]).toMatchObject({ id: "mao", motivos: ["TRANSFERENCIA_EM_DOBRO", "PARECE_TRANSFERENCIA"] });
    expect(s.map((x) => x.id)).toContain("r1");
    expect(s.map((x) => x.id)).not.toContain("combustivel");
  });
});
