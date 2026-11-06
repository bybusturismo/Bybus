import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { WaConversaDetalhe, WaLista, WaMensagens } from "../api/tipos";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { Whatsapp, formatarTelefone } from "./Whatsapp";

const modo = { provedor: "simulado", envioReal: false, simulado: true, avisosLigados: true, conexao: null } as const;
const agora = new Date().toISOString();
const lista: WaLista = {
  modo, naoLidasTotal: 2,
  conversas: [
    { id: "c1", telefone: "5531900001111", nome: "Turista Mineira", naoLidas: 2, ultimaMensagemEm: agora, unidadeId: null, unidadeCodigo: null, previa: "Qual o ponto de embarque?", previaTipo: "TEXTO", previaDirecao: "ENTRADA" },
    { id: "c2", telefone: "5511900002222", nome: null, naoLidas: 0, ultimaMensagemEm: agora, unidadeId: null, unidadeCodigo: null, previa: "Sua saída é amanhã", previaTipo: "TEXTO", previaDirecao: "SAIDA" },
  ],
};
const detalhe = (reservas: WaConversaDetalhe["reservas"] = []): WaConversaDetalhe => ({ id: "c1", telefone: "5531900001111", nome: "Turista Mineira", naoLidas: 0, unidadeId: null, modo, reservas });
const mensagens: WaMensagens = {
  temMais: false,
  itens: [
    { id: "m2", direcao: "SAIDA", texto: "Sua saída é amanhã às 8h.", tipo: "TEXTO", status: "SIMULADA", criadoEm: agora, automatica: true, tipoFila: "CONFIRMACAO", enviadaPor: null },
    { id: "m1", direcao: "ENTRADA", texto: "Qual o ponto de embarque?", tipo: "TEXTO", status: "RECEBIDA", criadoEm: new Date(Date.now() - 60_000).toISOString(), automatica: false, tipoFila: null, enviadaPor: null },
  ],
};
const sessao = (responder = true) => sessaoFicticia("ATENDENTE", responder ? ["whatsapp:ver", "whatsapp:responder"] : ["whatsapp:ver"]);

function api(extra: Record<string, unknown> = {}, d = detalhe()) {
  return simularApi({
    "GET /api/whatsapp/conversas": lista,
    "GET /api/whatsapp/conversas/c1": d,
    "GET /api/whatsapp/conversas/c1/mensagens": mensagens,
    "POST /api/whatsapp/conversas/c1/lida": { ok: true },
    ...extra,
  });
}

describe("WhatsApp", () => {
  it("formata telefones", () => {
    expect(formatarTelefone("5548999990000")).toBe("+55 (48) 99999-0000");
    expect(formatarTelefone("5411955550000")).toBe("+5411955550000");
    expect(formatarTelefone("lid:123")).toBe("Número oculto pelo WhatsApp");
  });

  it("lista as conversas com prévia, não lidas e o aviso do modo simulado", async () => {
    api();
    renderizar(<Whatsapp />, { sessao: sessao() });
    expect(await screen.findByText("Turista Mineira")).toBeInTheDocument();
    expect(screen.getByText("+55 (11) 90000-2222")).toBeInTheDocument(); // sem nome: mostra o telefone
    expect(screen.getByText("Qual o ponto de embarque?")).toBeInTheDocument();
    expect(screen.getByText("Você: Sua saída é amanhã")).toBeInTheDocument();
    expect(screen.getByLabelText("2 não lidas")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp em modo simulado")).toBeInTheDocument();
    expect(screen.getByText(/Nada é enviado de verdade/)).toBeInTheDocument();
  });

  it("abre a conversa: balões, mensagem automática marcada, reservas do contato e leitura", async () => {
    api({}, detalhe([{ reservaId: "r1", saidaId: "s1", data: "2031-05-10", passeio: "City Tour Toda Ilha", titular: "Marina Fictícia", canal: "PAYTOUR", passageiros: 2, proxima: true }]));
    renderizar(<Whatsapp />, { sessao: sessao(), rota: "/whatsapp?c=c1" });
    const conversa = within(await screen.findByRole("region", { name: "Conversa" }));
    expect(await conversa.findByText("Sua saída é amanhã às 8h.")).toBeInTheDocument();
    expect(conversa.getByText("Automática · confirmação")).toBeInTheDocument();
    expect(conversa.getByText(/simulada/)).toBeInTheDocument();
    expect(conversa.getByRole("link", { name: /City Tour Toda Ilha/ })).toHaveAttribute("href", "/saidas/s1");
    expect(conversa.getByText(/próxima/)).toBeInTheDocument();
  });

  it("contato sem reserva e marcação de lida ao abrir", async () => {
    const spy = api({ "GET /api/whatsapp/conversas/c1": { ...detalhe(), naoLidas: 2 } });
    renderizar(<Whatsapp />, { sessao: sessao(), rota: "/whatsapp?c=c1" });
    expect(await screen.findByText("Contato sem reserva")).toBeInTheDocument();
    await waitFor(() => expect(spy.mock.calls.some(([u, i]) => String(u).endsWith("/conversas/c1/lida") && i?.method === "POST")).toBe(true));
  });

  it("Enter envia a resposta; Shift+Enter quebra a linha", async () => {
    const spy = api({ "POST /api/whatsapp/conversas/c1/responder": { id: "m3", status: "SIMULADA", erro: null } });
    renderizar(<Whatsapp />, { sessao: sessao(), rota: "/whatsapp?c=c1" });
    const caixa = await screen.findByLabelText("Mensagem");
    await userEvent.type(caixa, "O embarque é no Ponto 3{Shift>}{Enter}{/Shift}às 8h{Enter}");
    await waitFor(() => expect(corpoEnviado(spy, "POST", "/api/whatsapp/conversas/c1/responder")).toEqual({ texto: "O embarque é no Ponto 3\nàs 8h" }));
    await waitFor(() => expect(caixa).toHaveValue(""));
  });

  it("falha no envio mostra aviso", async () => {
    api({ "POST /api/whatsapp/conversas/c1/responder": { id: "m3", status: "FALHA", erro: "HTTP 500" } });
    renderizar(<Whatsapp />, { sessao: sessao(), rota: "/whatsapp?c=c1" });
    await userEvent.type(await screen.findByLabelText("Mensagem"), "Oi{Enter}");
    expect(await screen.findByText(/não aceitou a mensagem/)).toBeInTheDocument();
  });

  it("sem whatsapp:responder só lê (sem caixa de resposta nem Nova conversa)", async () => {
    api();
    renderizar(<Whatsapp />, { sessao: sessao(false), rota: "/whatsapp?c=c1" });
    expect(await screen.findByText(/não responder/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova conversa/ })).not.toBeInTheDocument();
  });

  it("busca e filtro de não lidas vão para a API", async () => {
    const spy = api();
    renderizar(<Whatsapp />, { sessao: sessao() });
    await screen.findByText("Turista Mineira");
    await userEvent.type(screen.getByLabelText("Buscar conversa"), "minei");
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes("busca=minei"))).toBe(true));
    await userEvent.click(screen.getByRole("checkbox", { name: /Não lidas/ }));
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes("naoLidas=1"))).toBe(true));
  });
});
