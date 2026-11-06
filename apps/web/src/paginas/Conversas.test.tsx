import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { WaConversaDetalhe, WaLista, WaMensagens } from "../api/tipos";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../teste/ajuda";
import { Conversas, formatarTelefone } from "./Conversas";

const modo = { provedor: "simulado", envioReal: false, simulado: true, avisosLigados: true, conexao: null } as const;
const agora = new Date().toISOString();
const lista: WaLista = {
  modo, naoLidasTotal: 2, naoLidasPorCanal: { WHATSAPP: 2 }, minhasConversas: 1,
  conversas: [
    { id: "c1", canal: "WHATSAPP", etiquetas: ["DUVIDA"], atendenteId: "u1", atendenteNome: "Atendente Teste", telefone: "5531900001111", nome: "Turista Mineira", naoLidas: 2, ultimaMensagemEm: agora, unidadeId: null, unidadeCodigo: null, previa: "Qual o ponto de embarque?", previaTipo: "TEXTO", previaDirecao: "ENTRADA" },
    { id: "c2", canal: "INSTAGRAM", etiquetas: [], atendenteId: null, atendenteNome: null, telefone: "5511900002222", nome: null, naoLidas: 0, ultimaMensagemEm: agora, unidadeId: null, unidadeCodigo: null, previa: "Sua saída é amanhã", previaTipo: "TEXTO", previaDirecao: "SAIDA" },
  ],
};
const variaveis = { nome: "Turista", passeio: "City Tour Toda Ilha", data: "10/05/2031", ponto: null, horario: null };
const detalhe = (reservas: WaConversaDetalhe["reservas"] = []): WaConversaDetalhe => ({ id: "c1", canal: "WHATSAPP", telefone: "5531900001111", nome: "Turista Mineira", naoLidas: 0, unidadeId: null, modo, reservas, etiquetas: ["DUVIDA"], atendenteId: null, janela: null, variaveis });
const respostas = [
  { id: "r1", atalho: "ponto", titulo: "Ponto de embarque", idioma: "PT", texto: "Olá, {nome}! O {passeio} sai de {ponto}.", revisada: true },
  { id: "r2", atalho: "ponto", titulo: "Pickup point", idioma: "EN", texto: "Hello, {nome}! Pickup at {ponto}.", revisada: false },
  { id: "r3", atalho: "chuva", titulo: "Chuva", idioma: "PT", texto: "Vamos acompanhar a previsão, {nome}.", revisada: true },
];
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
    "GET /api/whatsapp/respostas-rapidas": respostas,
    "GET /api/whatsapp/atendentes": [{ id: "u1", nome: "Atendente Teste" }, { id: "u2", nome: "Outra Pessoa" }],
    "GET /api/whatsapp/conversas/c1": d,
    "GET /api/whatsapp/conversas/c1/mensagens": mensagens,
    "POST /api/whatsapp/conversas/c1/lida": { ok: true },
    ...extra,
  });
}

describe("Conversas", () => {
  it("formata telefones", () => {
    expect(formatarTelefone("5548999990000")).toBe("+55 (48) 99999-0000");
    expect(formatarTelefone("5411955550000")).toBe("+5411955550000");
    expect(formatarTelefone("lid:123")).toBe("Número oculto pelo WhatsApp");
  });

  it("lista as conversas com prévia, não lidas e o aviso do modo simulado", async () => {
    api();
    renderizar(<Conversas />, { sessao: sessao() });
    expect(await screen.findByText("Turista Mineira")).toBeInTheDocument();
    expect(screen.getByText("+55 (11) 90000-2222")).toBeInTheDocument(); // sem nome: mostra o telefone
    expect(screen.getByText("Qual o ponto de embarque?")).toBeInTheDocument();
    expect(screen.getByText("Você: Sua saída é amanhã")).toBeInTheDocument();
    expect(screen.getByLabelText("2 não lidas")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp em modo simulado")).toBeInTheDocument();
    expect(screen.getByTitle("Instagram")).toBeInTheDocument(); // ícone do canal da conversa c2
    expect(screen.getByText(/Nada é enviado de verdade/)).toBeInTheDocument();
  });

  it("abre a conversa: balões, mensagem automática marcada, reservas do contato e leitura", async () => {
    api({}, detalhe([{ reservaId: "r1", saidaId: "s1", data: "2031-05-10", passeio: "City Tour Toda Ilha", titular: "Marina Fictícia", canal: "PAYTOUR", passageiros: 2, proxima: true }]));
    renderizar(<Conversas />, { sessao: sessao(), rota: "/conversas?c=c1" });
    const conversa = within(await screen.findByRole("region", { name: "Conversa" }));
    expect(await conversa.findByText("Sua saída é amanhã às 8h.")).toBeInTheDocument();
    expect(conversa.getByText("Automática · confirmação")).toBeInTheDocument();
    expect(conversa.getByText(/simulada/)).toBeInTheDocument();
    expect(conversa.getByRole("link", { name: /City Tour Toda Ilha/ })).toHaveAttribute("href", "/saidas/s1");
    expect(conversa.getByText(/próxima/)).toBeInTheDocument();
  });

  it("contato sem reserva e marcação de lida ao abrir", async () => {
    const spy = api({ "GET /api/whatsapp/conversas/c1": { ...detalhe(), naoLidas: 2 } });
    renderizar(<Conversas />, { sessao: sessao(), rota: "/conversas?c=c1" });
    expect(await screen.findByText("Contato sem reserva")).toBeInTheDocument();
    await waitFor(() => expect(spy.mock.calls.some(([u, i]) => String(u).endsWith("/conversas/c1/lida") && i?.method === "POST")).toBe(true));
  });

  it("Enter envia a resposta; Shift+Enter quebra a linha", async () => {
    const spy = api({ "POST /api/whatsapp/conversas/c1/responder": { id: "m3", status: "SIMULADA", erro: null } });
    renderizar(<Conversas />, { sessao: sessao(), rota: "/conversas?c=c1" });
    const caixa = await screen.findByLabelText("Mensagem");
    await userEvent.type(caixa, "O embarque é no Ponto 3{Shift>}{Enter}{/Shift}às 8h{Enter}");
    await waitFor(() => expect(corpoEnviado(spy, "POST", "/api/whatsapp/conversas/c1/responder")).toEqual({ texto: "O embarque é no Ponto 3\nàs 8h" }));
    await waitFor(() => expect(caixa).toHaveValue(""));
  });

  it("falha no envio mostra aviso", async () => {
    api({ "POST /api/whatsapp/conversas/c1/responder": { id: "m3", status: "FALHA", erro: "HTTP 500" } });
    renderizar(<Conversas />, { sessao: sessao(), rota: "/conversas?c=c1" });
    await userEvent.type(await screen.findByLabelText("Mensagem"), "Oi{Enter}");
    expect(await screen.findByText(/não aceitou a mensagem/)).toBeInTheDocument();
  });

  it("sem whatsapp:responder só lê (sem caixa de resposta nem Nova conversa)", async () => {
    api();
    renderizar(<Conversas />, { sessao: sessao(false), rota: "/conversas?c=c1" });
    expect(await screen.findByText(/não responder/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova conversa/ })).not.toBeInTheDocument();
  });

  it("busca e filtro de não lidas vão para a API", async () => {
    const spy = api();
    renderizar(<Conversas />, { sessao: sessao() });
    await screen.findByText("Turista Mineira");
    await userEvent.type(screen.getByLabelText("Buscar conversa"), "minei");
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes("busca=minei"))).toBe(true));
    await userEvent.click(screen.getByRole("checkbox", { name: /Não lidas/ }));
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes("naoLidas=1"))).toBe(true));
  });

  it("filtra por canal, etiqueta e atendente (vai para a API) e mostra o contador de minhas conversas", async () => {
    const spy = api();
    renderizar(<Conversas />, { sessao: sessao() });
    await screen.findByText("Turista Mineira");
    expect(screen.getByRole("button", { name: "Minhas conversas (1)" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Canal"), "INSTAGRAM");
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes("canal=INSTAGRAM"))).toBe(true));
    await userEvent.selectOptions(screen.getByLabelText("Etiqueta"), "DUVIDA");
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes("etiqueta=DUVIDA"))).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: /Minhas conversas/ }));
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes("atendente=eu"))).toBe(true));
  });

  it("etiqueta e atribui a conversa", async () => {
    const spy = api({ "PUT /api/whatsapp/conversas/c1/etiquetas": { etiquetas: ["DUVIDA", "ORCAMENTO"] }, "POST /api/whatsapp/conversas/c1/atribuir": { atendenteId: "u1" } });
    renderizar(<Conversas />, { sessao: sessao(), rota: "/conversas?c=c1" });
    const grupo = within(await screen.findByRole("group", { name: "Etiquetas" }));
    expect(grupo.getByRole("button", { name: "Dúvida" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(grupo.getByRole("button", { name: "Orçamento" }));
    await waitFor(() => expect(corpoEnviado(spy, "PUT", "/api/whatsapp/conversas/c1/etiquetas")).toEqual({ etiquetas: ["DUVIDA", "ORCAMENTO"] }));
    await userEvent.click(screen.getByRole("button", { name: "Assumir" }));
    await waitFor(() => expect(corpoEnviado(spy, "POST", "/api/whatsapp/conversas/c1/atribuir")).toEqual({ usuarioId: "u1" }));
  });

  it("\"/\" abre as respostas prontas; escolher preenche as variáveis conhecidas e deixa as que faltam para completar", async () => {
    const spy = api({ "POST /api/whatsapp/conversas/c1/responder": { id: "m3", status: "SIMULADA", erro: null } });
    renderizar(<Conversas />, { sessao: sessao(), rota: "/conversas?c=c1" });
    const caixa = await screen.findByLabelText("Mensagem");
    await userEvent.type(caixa, "/pon");
    const lista = within(await screen.findByRole("region", { name: "Respostas prontas" }));
    expect(lista.getByText("Ponto de embarque")).toBeInTheDocument();
    expect(lista.queryByText("Chuva")).not.toBeInTheDocument();
    expect(lista.getByText("a revisar")).toBeInTheDocument();
    await userEvent.click(lista.getByRole("button", { name: "EN" })); // filtro de idioma
    expect(lista.queryByText("Ponto de embarque")).not.toBeInTheDocument();
    await userEvent.click(lista.getByRole("button", { name: "PT" }));
    await userEvent.click(lista.getByText("Ponto de embarque"));
    expect(caixa).toHaveValue("Olá, Turista! O City Tour Toda Ilha sai de {ponto}.");
    expect(screen.getByText(/Complete antes de enviar: \{ponto\}/)).toBeInTheDocument();
    await userEvent.type(caixa, "{Enter}"); // ainda tem {ponto}: não envia
    expect(screen.getByText(/Complete os trechos entre chaves/)).toBeInTheDocument();
    expect(spy.mock.calls.some(([u]) => String(u).endsWith("/responder"))).toBe(false);
  });

  it("Enter com \"/atalho\" escolhe a resposta em vez de enviar o atalho", async () => {
    const spy = api();
    renderizar(<Conversas />, { sessao: sessao(), rota: "/conversas?c=c1" });
    const caixa = await screen.findByLabelText("Mensagem");
    await userEvent.type(caixa, "/chuva{Enter}");
    expect(caixa).toHaveValue("Vamos acompanhar a previsão, Turista.");
    expect(spy.mock.calls.some(([u]) => String(u).endsWith("/responder"))).toBe(false);
  });

  it("Instagram: mostra o tempo restante da janela de 24 h; fechada, avisa e bloqueia a resposta", async () => {
    const ig = { ...detalhe(), canal: "INSTAGRAM" as const, telefone: "ig:123", nome: "turista_ficticio" };
    api({ "GET /api/whatsapp/conversas/c1": { ...ig, janela: { aberta: true, expiraEm: agora, minutosRestantes: 150 } } });
    const { unmount } = renderizar(<Conversas />, { sessao: sessao(), rota: "/conversas?c=c1" });
    expect(await screen.findByText(/você pode responder por mais 2 h 30 min/)).toBeInTheDocument();
    unmount();
    api({ "GET /api/whatsapp/conversas/c1": { ...ig, janela: { aberta: false, expiraEm: agora, minutosRestantes: 0 } } });
    renderizar(<Conversas />, { sessao: sessao(), rota: "/conversas?c=c1" });
    expect(await screen.findByText("Janela de 24 horas encerrada", { selector: "strong, p, div, span, h2, h3, h4" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Enviar/ })).toBeDisabled();
  });

  it("avisa que o Instagram não está conectado e abre a aba de comentários", async () => {
    api({
      "GET /api/whatsapp/conversas": { ...lista, modo: { ...modo, instagram: { conectado: false, real: false, simulado: true, avisosLigados: false } } },
      "GET /api/instagram/comentarios": { modo: { conectado: false, simulado: true }, naoLidos: 1, comentarios: [{ id: "k1", autor: "turista_ficticio", texto: "Lindo passeio!", escritoEm: agora, ehResposta: false, oculto: false, lido: true, respostaTexto: null, respostaStatus: null, respostaEm: null, post: { legenda: "Pôr do sol", link: null } }] },
      "POST /api/instagram/comentarios/k1/responder": { status: "SIMULADA", erro: null },
    });
    renderizar(<Conversas />, { sessao: sessao() });
    expect(await screen.findByText("Instagram não conectado")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Comentários do Instagram" }));
    expect(await screen.findByText("Lindo passeio!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ocultar" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Responder" }));
    await userEvent.type(screen.getByPlaceholderText("Resposta pública ao comentário"), "Obrigado!");
    await userEvent.click(screen.getByRole("button", { name: "Publicar resposta" }));
    await waitFor(() => expect(screen.queryByPlaceholderText("Resposta pública ao comentário")).not.toBeInTheDocument());
  });
});
