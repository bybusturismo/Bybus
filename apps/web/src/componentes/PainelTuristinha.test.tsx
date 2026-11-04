import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, renderizar, respostaJson, simularApi } from "../teste/ajuda";
import { PainelTuristinha } from "./PainelTuristinha";

describe("Painel do Turistinha", () => {
  it("conversa com o assistente e mostra a resposta", async () => {
    const api = simularApi({
      "GET /api/ia/estado": { ligada: true, assistente: true, gestores: false },
      "POST /api/ia/assistente": { resposta: "Amanhã há 3 saídas, todas com guia.", ferramentas: ["resumo_saidas"], custoUsd: 0.01 },
    });
    renderizar(<PainelTuristinha aoFechar={() => {}} />);
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText("Sua pergunta"), "Como estão as saídas de amanhã?");
    await u.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Amanhã há 3 saídas, todas com guia.")).toBeInTheDocument();
    expect(corpoEnviado(api, "POST", "/api/ia/assistente")).toEqual({ mensagens: [{ papel: "usuario", texto: "Como estão as saídas de amanhã?" }] });
  });

  it("sem chave da IA mostra 'IA desligada' e não deixa enviar", async () => {
    simularApi({ "GET /api/ia/estado": { ligada: false, assistente: true, gestores: false } });
    renderizar(<PainelTuristinha aoFechar={() => {}} />);
    expect(await screen.findByText("IA desligada")).toBeInTheDocument();
    expect(screen.getByLabelText("Sua pergunta")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeDisabled();
  });

  it("mostra o erro da API (ex.: limite mensal) no lugar da resposta", async () => {
    simularApi({ "GET /api/ia/estado": { ligada: true, assistente: true, gestores: false } });
    const original = globalThis.fetch;
    globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      if (String(entrada).includes("/api/ia/assistente")) return respostaJson(429, { codigo: "IA_LIMITE", mensagem: "Limite mensal de IA atingido." });
      return original(entrada, init);
    }) as typeof fetch;
    try {
      renderizar(<PainelTuristinha aoFechar={() => {}} />);
      const u = userEvent.setup();
      await u.type(await screen.findByLabelText("Sua pergunta"), "Oi");
      await u.click(screen.getByRole("button", { name: "Enviar" }));
      expect(await screen.findByText("Limite mensal de IA atingido.")).toBeInTheDocument();
    } finally {
      globalThis.fetch = original;
    }
  });
});
