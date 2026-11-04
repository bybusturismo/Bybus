import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AcaoIa, AvaliacaoDetalheIa } from "../api/tipos";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { Gestores } from "./Gestores";

const sessao = sessaoFicticia("ADMIN", ["ia:gestores", "ia:usar"], { todasUnidades: true });
const acao = (id: string, extra: Partial<AcaoIa> = {}): AcaoIa => ({ id, titulo: `Ação ${id}`, detalhe: "Detalhe fictício.", area: "logistico", prioridade: "alta", prazoDias: 3, status: "SUGERIDA", decididaEm: null, observacao: null, ...extra });
const retratosVazios = Object.fromEntries(["comercial", "logistico", "frotas", "administrativo", "marketing", "juridico", "rh", "tecnologia"].map((g) => [g, { alertas: g === "rh" ? ["2 saída(s) sem guia"] : [] }]));

const detalhe: AvaliacaoDetalheIa = {
  id: "a1", dataRef: "2026-11-04", origem: "AUTOMATICA", status: "CONCLUIDA", modelo: "claude-opus-5-5", modeloSintese: "claude-opus-5-5", iniciadaEm: "2026-11-04T09:30:00Z", concluidaEm: "2026-11-04T09:35:00Z", erro: null, custoUsd: 0.31,
  retratos: retratosVazios as AvaliacaoDetalheIa["retratos"],
  sintese: {
    resumo: "Operação estável; atenção à escala de sábado.",
    vulnerabilidades: [{ titulo: "Sábado sem guia", detalhe: "Duas saídas sem guia.", gravidade: "alta", evidencia: "Retrato logístico" }],
    oportunidades: [{ titulo: "Venda direta", detalhe: "Canal próprio abaixo do potencial.", impacto: "alto", evidencia: "Mix de canais" }],
    acoes_sugeridas: [],
    pontos_de_discordia: ["Reforçar frota ou remanejar saídas?"],
  },
  pareceres: [
    { gestor: "logistico", rodada: 1, conteudo: { achados: [{ titulo: "Saídas sem guia", detalhe: "Duas.", gravidade: "alta", evidencia: "x" }], vulnerabilidades: [], oportunidades: [], acoes_sugeridas: [] } },
    { gestor: "rh", rodada: 2, conteudo: { comentarios: [{ gestor: "logistico", tipo: "complemento", texto: "Há guia disponível com idioma inglês." }], riscos_cruzados: [{ titulo: "Cadastur e lotação", detalhe: "Guia com Cadastur vencendo em saída lotada.", areas: ["rh", "juridico"] }], acoes_sugeridas: [] } },
  ],
  acoes: [acao("1"), acao("2", { status: "APROVADA" })],
};

const base = {
  "GET /api/ia/estado": { ligada: true, assistente: true, gestores: true, modelo: "claude-opus-5-5", modeloSintese: "claude-opus-5-5", limiteMesUsd: 40, gastoMesUsd: 1.5, avaliacaoDiaria: true, horario: "06:30", emAndamento: false },
  "GET /api/ia/avaliacoes": [{ id: "a1", dataRef: "2026-11-04", origem: "AUTOMATICA", status: "CONCLUIDA", modelo: "m", modeloSintese: "m", iniciadaEm: "2026-11-04T09:30:00Z", concluidaEm: null, erro: null, custoUsd: 0.31, resumo: "ok", acoes: { SUGERIDA: 1, APROVADA: 1 } }],
  "GET /api/ia/avaliacoes/a1": detalhe,
  "GET /api/ia/retratos": { data: "2026-11-04", retratos: retratosVazios },
  "GET /api/ia/acoes": [acao("1"), acao("2", { status: "APROVADA" })],
};

describe("Gestores de IA", () => {
  it("mostra o painel do dia com a síntese, vulnerabilidades, oportunidades e ações", async () => {
    simularApi(base);
    renderizar(<Gestores />, { sessao });
    expect(await screen.findByText("Operação estável; atenção à escala de sábado.")).toBeInTheDocument();
    expect(screen.getByText("Sábado sem guia")).toBeInTheDocument();
    expect(screen.getByText("Venda direta")).toBeInTheDocument();
    expect(screen.getByText("Reforçar frota ou remanejar saídas?")).toBeInTheDocument();
    expect(screen.getByText(/Gasto no mês:/)).toHaveTextContent("US$ 1,50 de US$ 40,00");
    // Alertas calculados direto dos dados, com o gestor de origem.
    expect(await screen.findByText("2 saída(s) sem guia")).toBeInTheDocument();
  });

  it("aprova e descarta ações sugeridas (e só oferece 'concluir' depois de aprovar)", async () => {
    const api = simularApi({ ...base, "PATCH /api/ia/acoes/1": { ok: true, status: "APROVADA" } });
    renderizar(<Gestores />, { sessao });
    const u = userEvent.setup();
    await screen.findByText("Ação 1");
    await u.click(screen.getByRole("button", { name: "Aprovar: Ação 1" }));
    expect(corpoEnviado(api, "PATCH", "/api/ia/acoes/1")).toEqual({ status: "APROVADA" });
    expect(screen.queryByRole("button", { name: "Aprovar: Ação 2" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como concluída: Ação 2" })).toBeInTheDocument();
  });

  it("mostra cada gestor e a conversa entre eles", async () => {
    simularApi(base);
    renderizar(<Gestores />, { sessao });
    const u = userEvent.setup();
    await screen.findByText("Operação estável; atenção à escala de sábado.");
    await u.click(screen.getByRole("tab", { name: "Cada gestor" }));
    await u.click(screen.getByRole("button", { name: "Logístico" }));
    expect(await screen.findByText("Saídas sem guia")).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "A conversa entre eles" }));
    expect(screen.getByText("Há guia disponível com idioma inglês.")).toBeInTheDocument();
    expect(screen.getByText(/RH complementa com Logístico/)).toBeInTheDocument();
    const riscos = screen.getByRole("region", { name: "Riscos que cruzam áreas" });
    expect(within(riscos).getByText("Cadastur e lotação")).toBeInTheDocument();
  });

  it("'Rodar agora' inicia a avaliação; com a IA desligada o botão fica desativado e há o aviso", async () => {
    const api = simularApi({ ...base, "POST /api/ia/avaliacoes": { id: "a1" } });
    const { unmount } = renderizar(<Gestores />, { sessao });
    const u = userEvent.setup();
    await u.click(await screen.findByRole("button", { name: /Rodar agora/ }));
    expect(api.mock.calls.some(([url, init]) => String(url) === "/api/ia/avaliacoes" && init?.method === "POST")).toBe(true);
    unmount();

    simularApi({ ...base, "GET /api/ia/estado": { ligada: false, assistente: true, gestores: true, limiteMesUsd: 40, gastoMesUsd: 0 }, "GET /api/ia/avaliacoes": [] });
    renderizar(<Gestores />, { sessao });
    expect(await screen.findByText("IA desligada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rodar agora/ })).toBeDisabled();
  });
});
