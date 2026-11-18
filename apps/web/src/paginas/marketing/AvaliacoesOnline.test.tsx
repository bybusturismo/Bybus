import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, FLN, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { AvaliacoesOnline } from "./AvaliacoesOnline";

const gerente = sessaoFicticia("MKT", ["marketing:ver", "marketing:gerenciar"], { unidades: [FLN] });
const leitor = sessaoFicticia("MKT_LER", ["marketing:ver"], { unidades: [FLN] });
const desligado = {
  estado: { google: { configurado: false, conectado: false, retorno: "https://gestao.exemplo.test/api/marketing/google/retorno" }, tripadvisor: { configurado: false } },
  ultima: null, locais: { [FLN.id]: { google: null, tripadvisor: "2362697", nome: "Florianópolis", codigo: "FLN" } }, resumo: [], itens: [],
};
const ligado = {
  ...desligado,
  estado: { google: { configurado: true, conectado: true, retorno: "https://gestao.exemplo.test/api/marketing/google/retorno" }, tripadvisor: { configurado: true } },
  ultima: { em: "2026-11-18T10:05:00Z" },
  resumo: [
    { unidadeId: FLN.id, praca: "Florianópolis", canal: "GOOGLE", configurado: true, media: 4.7, total: 812, link: null, selo: null, erro: null, guardadas: { quantidade: 2, media: 3.5, semResposta: 1 }, novas: 1 },
    { unidadeId: FLN.id, praca: "Florianópolis", canal: "TRIPADVISOR", configurado: true, media: 4.5, total: 3456, link: "https://www.tripadvisor.com.br/x", selo: "https://static.tacdn.com/img/4.5.svg", erro: null, guardadas: { quantidade: 1, media: 5, semResposta: 0 }, novas: 0 },
  ],
  itens: [
    { id: "a1", canal: "GOOGLE", unidadeId: FLN.id, autor: null, nota: 2, titulo: null, texto: "Ônibus atrasou", idioma: null, publicadaEm: "2026-11-16T12:00:00Z", url: null, resposta: null, respondidaEm: null, lida: false },
    { id: "a2", canal: "TRIPADVISOR", unidadeId: FLN.id, autor: "viajante_ficticio", nota: 5, titulo: "Excelente", texto: "Guia ótimo", idioma: "pt", publicadaEm: "2026-11-15T10:00:00Z", url: "https://www.tripadvisor.com.br/r", resposta: null, respondidaEm: null, lida: true },
  ],
};

describe("Google e Tripadvisor", () => {
  it("desligado: mostra o passo a passo e o endereço de retorno; sem botão de atualizar", async () => {
    simularApi({ "GET /api/marketing/avaliacoes-online": desligado });
    renderizar(<AvaliacoesOnline />, { sessao: gerente });
    expect(await screen.findByText("Ligue o Google ou o Tripadvisor para ver as avaliações aqui.")).toBeInTheDocument();
    expect(screen.getByText("https://gestao.exemplo.test/api/marketing/google/retorno")).toBeInTheDocument();
    expect(screen.getByLabelText("Número do local no Tripadvisor")).toHaveValue("2362697");
    expect(screen.queryByRole("button", { name: /Atualizar agora/ })).not.toBeInTheDocument();
  });

  it("ligado: resumo com nota e total oficiais, avaliações com estrelas, resposta no Google e filtros", async () => {
    const spy = simularApi({
      "GET /api/marketing/avaliacoes-online": ligado,
      "POST /api/marketing/avaliacoes-online/a1/responder": { ...ligado.itens[0], resposta: "Sentimos muito." },
      "POST /api/marketing/avaliacoes-online/lidas": { ok: true },
      "POST /api/marketing/avaliacoes-online/atualizar": { resultados: [{ canal: "GOOGLE", ok: true, novas: 2 }] },
    });
    renderizar(<AvaliacoesOnline />, { sessao: gerente });
    const u = userEvent.setup();
    const google = await screen.findByRole("region", { name: "Google · Florianópolis" });
    expect(google).toHaveTextContent(/4,7.*812 avaliações/);
    expect(google).toHaveTextContent("1 nova(s) · 1 nota(s) até 3 sem resposta");
    const ta = screen.getByRole("region", { name: "Tripadvisor · Florianópolis" });
    expect(within(ta).getByRole("img", { name: "Nota 4,5 no Tripadvisor" })).toBeInTheDocument();
    expect(within(ta).getByRole("link", { name: "Ver no Tripadvisor" })).toHaveAttribute("href", "https://www.tripadvisor.com.br/x");
    expect(screen.getByLabelText("Nota 2 de 5")).toHaveTextContent("★★☆☆☆");
    expect(screen.getByText("Anônimo")).toBeInTheDocument();
    // responder no Google
    await u.click(screen.getByRole("button", { name: "Responder" }));
    await u.type(screen.getByLabelText("Resposta pública no Google"), "Sentimos muito.");
    await u.click(screen.getByRole("button", { name: "Publicar resposta" }));
    expect(corpoEnviado(spy, "POST", "/api/marketing/avaliacoes-online/a1/responder")).toEqual({ texto: "Sentimos muito." });
    // filtros e marcar como lida
    await u.click(screen.getByLabelText("Só notas até 3"));
    expect(spy.mock.calls.some(([x]) => String(x).includes("notaAte=3"))).toBe(true);
    await u.click(screen.getByRole("button", { name: "Marcar todas como lidas" }));
    expect(corpoEnviado(spy, "POST", "/api/marketing/avaliacoes-online/lidas")).toEqual({ ids: ["a1"] });
    await u.click(screen.getByRole("button", { name: /Atualizar agora/ }));
    expect(await screen.findByText("Atualizado: 2 avaliação(ões) nova(s).")).toBeInTheDocument();
  });

  it("quem só vê não responde nem configura; volta do Google mostra o aviso", async () => {
    simularApi({ "GET /api/marketing/avaliacoes-online": ligado });
    renderizar(<AvaliacoesOnline />, { sessao: leitor, rota: "/marketing/avaliacoes-online?google=conectado" });
    await screen.findByRole("region", { name: "Google · Florianópolis" });
    expect(screen.queryByRole("button", { name: "Responder" })).not.toBeInTheDocument();
    expect(screen.queryByText("Ligar Google e Tripadvisor")).not.toBeInTheDocument();
    expect(screen.getByText(/Conta Google conectada/)).toBeInTheDocument();
  });
});
