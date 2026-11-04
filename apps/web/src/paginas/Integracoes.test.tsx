import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { Integracoes, resumoResultado } from "./Integracoes";

describe("Integrações", () => {
  it("resume o resultado dos dois formatos (Paytour aninhado e e-mails direto)", () => {
    expect(resumoResultado(null)).toBe("Ainda não rodou.");
    expect(resumoResultado({ pedidos: 5, resumo: { CRIAR: 3, ATUALIZAR: 1, CANCELAR: 1, IGNORAR: 0 } })).toBe("5 pedidos lidos · 3 reservas novas · 1 atualizada · 1 cancelada");
    expect(resumoResultado({ mensagens: 2, CRIAR: 0, ATUALIZAR: 0, semLeitor: 2 })).toBe("2 e-mails lidos · 2 aguardando leitor (Decolar)");
  });

  it("mostra a situação e sincroniza a Paytour a partir de uma data", async () => {
    const api = simularApi({
      "GET /api/integracoes/paytour": { configurada: true, automaticaACadaMinutos: 2, ultimaExecucaoEm: "2026-11-04T12:00:00Z", ultimoResultado: { pedidos: 4, resumo: { CRIAR: 4, ATUALIZAR: 0, CANCELAR: 0, IGNORAR: 0 } }, ultimoErro: null },
      "GET /api/integracoes/emails": { configurada: false, ultimaExecucaoEm: null, ultimoResultado: null },
      "POST /api/integracoes/paytour/sincronizar": { de: "", ate: "", pedidos: 1, previa: [], resumo: { CRIAR: 1, ATUALIZAR: 0, CANCELAR: 0, IGNORAR: 0 } },
    });
    renderizar(<Integracoes />, { sessao: sessaoFicticia("ADMIN", ["importacoes:executar"]) });
    expect(await screen.findByText("4 pedidos lidos · 4 reservas novas")).toBeInTheDocument();
    expect(screen.getByText(/a cada 2 minutos/)).toBeInTheDocument();
    expect(screen.getByText("Ainda não rodou.")).toBeInTheDocument();
    const u = userEvent.setup();
    await u.type(screen.getByLabelText("Reler desde"), "2026-10-01");
    await u.click(screen.getByRole("button", { name: "Reler a partir da data" }));
    expect(corpoEnviado(api, "POST", "/api/integracoes/paytour/sincronizar")).toEqual({ desde: "2026-10-01" });
  });
});
