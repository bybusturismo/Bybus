import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { Integracoes, resumoResultado } from "./Integracoes";

describe("Integrações", () => {
  it("resume o resultado dos dois formatos (Paytour aninhado e e-mails direto)", () => {
    expect(resumoResultado(null)).toBe("Ainda não rodou.");
    expect(resumoResultado({ pedidos: 5, resumo: { CRIAR: 3, ATUALIZAR: 1, CANCELAR: 1, IGNORAR: 0 } })).toBe("5 pedidos lidos · 3 reservas novas · 1 atualizada · 1 cancelada");
    expect(resumoResultado({ mensagens: 2, CRIAR: 0, ATUALIZAR: 0, precisamAtencao: 1 })).toBe("2 e-mails lidos · 1 e-mail da Decolar pede resposta da equipe");
  });

  it("mostra a situação e sincroniza a Paytour a partir de uma data", async () => {
    const api = simularApi({
      "GET /api/integracoes/paytour": { configurada: true, automaticaACadaMinutos: 2, ultimaExecucaoEm: "2026-11-04T12:00:00Z", ultimoResultado: { pedidos: 4, resumo: { CRIAR: 4, ATUALIZAR: 0, CANCELAR: 0, IGNORAR: 0 } }, ultimoErro: null },
      "GET /api/integracoes/emails": { configurada: false, ultimaExecucaoEm: null, ultimoResultado: null },
      "POST /api/integracoes/paytour/sincronizar": { de: "", ate: "", pedidos: 1, previa: [], resumo: { CRIAR: 1, ATUALIZAR: 0, CANCELAR: 0, IGNORAR: 0 } },
      "GET /api/whatsapp/meta": { provedor: "simulado", configurada: false, numeroConfigurado: false, avisosLigados: false, enderecoAvisos: null, erro: null, modelos: [] },
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

  it("WhatsApp oficial: mostra a situação dos modelos e envia os que faltam para aprovação", async () => {
    const api = simularApi({
      "GET /api/integracoes/paytour": { configurada: false, automaticaACadaMinutos: 2, ultimaExecucaoEm: null, ultimoResultado: null, ultimoErro: null },
      "GET /api/integracoes/emails": { configurada: false, ultimaExecucaoEm: null, ultimoResultado: null },
      "GET /api/whatsapp/meta": { provedor: "meta", configurada: true, numeroConfigurado: true, avisosLigados: true, enderecoAvisos: "https://gestao.exemplo.test/api/webhooks/whatsapp", erro: null,
        modelos: [{ nome: "bybus_previa", descricao: "Prévia da véspera", status: "APPROVED", motivo: null }, { nome: "bybus_confirmacao", descricao: "Confirmação da saída", status: "NAO_ENVIADO", motivo: null }] },
      "POST /api/whatsapp/meta/modelos/enviar": { enviados: ["bybus_confirmacao"], erros: [] },
    });
    renderizar(<Integracoes />, { sessao: sessaoFicticia("ADMIN", ["importacoes:executar"]) });
    expect(await screen.findByText("Aprovado")).toBeInTheDocument();
    expect(screen.getByText("https://gestao.exemplo.test/api/webhooks/whatsapp")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Enviar modelos para aprovação" }));
    expect(api.mock.calls.some(([u, i]) => String(u) === "/api/whatsapp/meta/modelos/enviar" && i?.method === "POST")).toBe(true);
  });

  it("produtos da Paytour não reconhecidos: classifica como revenda", async () => {
    const api = simularApi({
      "GET /api/integracoes/paytour": { configurada: true, automaticaACadaMinutos: 2, ultimaExecucaoEm: null, ultimoResultado: null, ultimoErro: null },
      "GET /api/integracoes/emails": { configurada: false, ultimaExecucaoEm: null, ultimoResultado: null },
      "GET /api/whatsapp/meta": { provedor: "simulado", configurada: false, numeroConfigurado: false, avisosLigados: false, enderecoAvisos: null, erro: null, modelos: [] },
      "GET /api/integracoes/paytour/produtos": { produtos: [{ produto: "Ingresso Parque Fictício", pedidos: 3, ultimaVezEm: "2026-11-09T12:00:00Z" }], passeios: [{ id: "p1", nome: "City Tour Toda Ilha", unidadeId: "u1" }], pracas: [{ id: "u1", nome: "Florianópolis" }] },
      "POST /api/integracoes/paytour/produtos/decidir": { ok: true, passeioId: null },
    });
    renderizar(<Integracoes />, { sessao: sessaoFicticia("ADMIN", ["importacoes:executar"]) });
    const u = userEvent.setup();
    await u.selectOptions(await screen.findByLabelText("O que é Ingresso Parque Fictício"), "Revenda de terceiros (não entra nas listas)");
    await u.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(corpoEnviado(api, "POST", "/api/integracoes/paytour/produtos/decidir")).toEqual({ produto: "Ingresso Parque Fictício", acao: "REVENDA" });
  });
});
