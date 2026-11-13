import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { Caixa } from "./Caixa";
import type { ContaFin } from "./tipos";

const conta: ContaFin = { id: "k1", unidadeId: FLN.id, nome: "Banco Teste", tipo: "CORRENTE", banco: null, finalConta: null, saldoInicialCentavos: 100000, saldoInicialEm: "2026-11-01", diaFechamento: null, diaVencimento: null, contaPagamentoId: null, ativa: true, saldoCentavos: 5100000, linhasPendentes: 0 };

describe("Conferir com o banco (13/11/2026)", () => {
  it("compara com o saldo do banco e aponta a transferência lançada em dobro", async () => {
    simularApi({
      "GET /api/financeiro/contas": [conta],
      "GET /api/financeiro/contas/k1/saldo-diario": { conta: { id: "k1", nome: "Banco Teste", tipo: "CORRENTE" }, saldoInicialCentavos: 0, dias: [] },
      "GET /api/financeiro/contas/k1/conferencia": (_c: unknown, url: string) => {
        expect(url).toContain("saldoBancoCentavos=2600000");
        return {
          saldoSistemaCentavos: 5100000, saldoBancoCentavos: 2600000, diferencaCentavos: 2500000,
          composicao: { saldoInicialCentavos: 100000, saldoInicialEm: "2026-11-01", transferenciasCentavos: 2500000, extratoCentavos: 0, entradasCentavos: 2500000, saidasCentavos: 0 },
          suspeitos: [{ id: "l1", origem: "LANCAMENTO", data: "2026-11-05", valorCentavos: 2500000, descricao: "TRANSF ENTRE CONTAS", transferencia: false, criadoPelaPlanilha: false, motivos: ["VALOR_DA_DIFERENCA", "TRANSFERENCIA_EM_DOBRO"] }],
        };
      },
    });
    renderizar(<Caixa />, { sessao: sessaoFicticia("FIN", ["financeiro:ver"], { unidades: [FLN] }) });
    const u = userEvent.setup();
    const sec = within(await screen.findByRole("region", { name: "Conferir com o banco" }));
    await u.type(sec.getByLabelText("Saldo no banco (R$)"), "26.000,00");
    await u.click(sec.getByRole("button", { name: "Conferir" }));
    expect(await sec.findByText(/a mais no sistema/)).toBeInTheDocument();
    const linha = sec.getByRole("row", { name: /TRANSF ENTRE CONTAS/ });
    expect(linha).toHaveTextContent("Lançamento (à mão)");
    expect(linha).toHaveTextContent("valor igual à diferença; lançado à mão e também como transferência");
  });
});
