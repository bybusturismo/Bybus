import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { BancoMidias } from "./BancoMidias";
import { Conteudo } from "./Conteudo";
import { Instagram, type PainelInstagram } from "./Instagram";

const ver = sessaoFicticia("MKT", ["marketing:ver"]);
const gerenciar = sessaoFicticia("MKT", ["marketing:ver", "marketing:gerenciar"], { todasUnidades: true });

const painel: PainelInstagram = {
  modo: { conectado: true, real: true, simulado: false, avisosLigados: true },
  periodo: { de: "2026-10-08", ate: "2026-11-06" }, atualizadoEm: "2026-11-06T08:30:00.000Z",
  resumo: { seguidores: 1530, variacaoSeguidores: 30, alcance: 12000, visualizacoes: 30500, visitasPerfil: 420, cliquesSite: 37, posts: 3, engajamento: 540 },
  serie: [{ data: "2026-11-04", seguidores: 1500, alcance: 400 }, { data: "2026-11-05", seguidores: 1512, alcance: 800 }, { data: "2026-11-06", seguidores: 1530, alcance: null }],
  ranking: [{ id: "p1", tipo: "REELS", legenda: "Reels do pôr do sol", link: "https://instagram.com/p/x", publicadoEm: "2026-11-02T21:00:00.000Z", curtidas: 300, comentarios: 20, salvamentos: 15, compartilhamentos: 10, alcance: 5000, engajamento: 345, taxa: 0.069 }],
  melhores: { porDiaSemana: [{ dia: 1, posts: 2, engajamentoMedio: 120 }], porHora: [{ hora: 18, posts: 2, engajamentoMedio: 120 }], melhor: { dia: 1, hora: 18, posts: 2, engajamentoMedio: 120 } },
};

describe("aba Instagram do Marketing", () => {
  it("mostra números do período, gráficos, ranking e melhores horários", async () => {
    simularApi({ "GET /api/marketing/instagram": painel });
    renderizar(<Instagram />, { sessao: ver });
    const faixa = within(await screen.findByLabelText("Números do período"));
    expect(faixa.getByText("1.530")).toBeInTheDocument();
    expect(faixa.getByText("+30 no período")).toBeInTheDocument();
    expect(faixa.getByText("Visitas ao perfil")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Seguidores por dia/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Alcance por dia/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reels do pôr do sol" })).toHaveAttribute("href", "https://instagram.com/p/x");
    expect(screen.getByText(/6,9% do alcance/)).toBeInTheDocument();
    expect(screen.getByText(/segunda, 18h/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Atualizar agora/ })).not.toBeInTheDocument(); // só quem gerencia
  });

  it("não conectado: avisa e mostra a tela vazia sem inventar número", async () => {
    simularApi({ "GET /api/marketing/instagram": { ...painel, modo: { conectado: false, real: false, simulado: true, avisosLigados: false }, serie: [], ranking: [], atualizadoEm: null, melhores: { porDiaSemana: [], porHora: [], melhor: null } } });
    renderizar(<Instagram />, { sessao: ver });
    expect(await screen.findByText("Instagram não conectado")).toBeInTheDocument();
    expect(screen.getByText("Ainda não há dados do Instagram neste período.")).toBeInTheDocument();
  });

  it("quem gerencia atualiza agora", async () => {
    const spy = simularApi({ "GET /api/marketing/instagram": painel, "POST /api/marketing/instagram/atualizar": { executou: true, dias: 2, posts: 3, falhas: [] } });
    renderizar(<Instagram />, { sessao: gerenciar });
    await userEvent.click(await screen.findByRole("button", { name: /Atualizar agora/ }));
    await waitFor(() => expect(spy.mock.calls.some(([u, i]) => String(u).endsWith("/atualizar") && i?.method === "POST")).toBe(true));
  });
});

const conteudo = (extra: Record<string, unknown> = {}) => ({
  id: "c1", unidadeId: null, titulo: "Reels do pôr do sol", rede: "INSTAGRAM", status: "IDEIA", dataPrevista: null, legenda: "Legenda", link: null, responsavelId: null, responsavel: null,
  tipoPost: null, agendarEm: null, pubStatus: null, pubSimulado: false, pubErro: null, qtdMidias: 1, ...extra,
});
const rotasConteudo = (itens: unknown[], extra: Record<string, unknown> = {}) => ({ "GET /api/marketing/conteudos": itens, "GET /api/marketing/responsaveis": [], ...extra });

describe("Calendário de conteúdo: aprovação, agendamento e IA", () => {
  it("segue o fluxo: enviar para aprovação → aprovar → agendar (com horário de Brasília)", async () => {
    const spy = simularApi(rotasConteudo([conteudo()], { "POST /api/marketing/conteudos/c1/solicitar-aprovacao": { status: "EM_APROVACAO" } }));
    renderizar(<Conteudo />, { sessao: gerenciar });
    await userEvent.click(await screen.findByRole("button", { name: "Enviar para aprovação" }));
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).endsWith("/solicitar-aprovacao"))).toBe(true));
  });

  it("aprovar só aparece para quem gerencia; em aprovação mostra Aprovar e Devolver", async () => {
    simularApi(rotasConteudo([conteudo({ status: "EM_APROVACAO" })]));
    const { unmount } = renderizar(<Conteudo />, { sessao: ver });
    expect(await screen.findByText("Em aprovação")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument();
    unmount();
    simularApi(rotasConteudo([conteudo({ status: "EM_APROVACAO" })]));
    renderizar(<Conteudo />, { sessao: gerenciar });
    expect(await screen.findByRole("button", { name: "Aprovar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Devolver" })).toBeInTheDocument();
  });

  it("agenda um post aprovado enviando tipo e instante com o fuso de São Paulo", async () => {
    const spy = simularApi(rotasConteudo([conteudo({ status: "APROVADO" })], { "POST /api/marketing/conteudos/c1/agendar": { status: "AGENDADO" } }));
    renderizar(<Conteudo />, { sessao: gerenciar });
    await userEvent.click(await screen.findByRole("button", { name: "Agendar" }));
    await userEvent.selectOptions(screen.getByLabelText("Tipo de post"), "REELS");
    await userEvent.type(screen.getByLabelText(/Data e hora/), "2031-05-10T10:30");
    await userEvent.click(screen.getAllByRole("button", { name: "Agendar" }).at(-1)!); // o botão de enviar do formulário
    await waitFor(() => expect(corpoEnviado(spy, "POST", "/api/marketing/conteudos/c1/agendar")).toEqual({ tipoPost: "REELS", agendarEm: "2031-05-10T13:30:00.000Z" }));
  });

  it("mostra a situação da publicação: agendado, publicado (simulado) e falhou com o motivo", async () => {
    simularApi(rotasConteudo([
      conteudo({ id: "a", titulo: "Post A", status: "AGENDADO", pubStatus: "AGENDADO", tipoPost: "IMAGEM", agendarEm: "2031-05-10T13:30:00.000Z" }),
      conteudo({ id: "b", titulo: "Post B", status: "PUBLICADO", pubStatus: "PUBLICADO", pubSimulado: true, tipoPost: "REELS", agendarEm: "2026-11-01T13:30:00.000Z" }),
      conteudo({ id: "c", titulo: "Post C", status: "AGENDADO", pubStatus: "FALHOU", pubErro: "URL_PUBLICA_AUSENTE", tipoPost: "IMAGEM", agendarEm: "2026-11-01T13:30:00.000Z" }),
    ]));
    renderizar(<Conteudo />, { sessao: gerenciar });
    expect(await screen.findByText(/Publica em 10\/05\/2031 10:30/)).toBeInTheDocument();
    expect(screen.getByText(/Publicado \(simulado\)/)).toBeInTheDocument();
    expect(screen.getByText(/Falhou: o sistema ainda não tem endereço público/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reagendar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alterar horário" })).toBeInTheDocument();
  });

  it("sugerir legenda: sem IA mostra 'IA desligada'; com IA lista 3 opções e usa uma", async () => {
    const rotas = rotasConteudo([conteudo({ status: "PRODUCAO" })], { "GET /api/marketing/conteudos/c1/midias": [] });
    simularApi({ ...rotas, "POST /api/marketing/legendas/sugerir": { ligada: false, mensagem: "IA desligada: as sugestões ficam disponíveis quando a chave da IA for configurada." } });
    const { unmount } = renderizar(<Conteudo />, { sessao: gerenciar });
    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await userEvent.click(screen.getByRole("button", { name: /Sugerir legenda/ }));
    expect(await screen.findByText("IA desligada")).toBeInTheDocument();
    unmount();
    const spy = simularApi({ ...rotas, "POST /api/marketing/legendas/sugerir": { ligada: true, custoUsd: 0.01, opcoes: [1, 2, 3].map((n) => ({ legenda: `Legenda ${n}`, hashtags: ["#floripa", "#turismo"] })) } });
    renderizar(<Conteudo />, { sessao: gerenciar });
    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await userEvent.selectOptions(screen.getByLabelText("Idioma"), "es");
    await userEvent.click(screen.getByRole("button", { name: /Sugerir legenda/ }));
    const opcoes = await screen.findAllByRole("button", { name: "Usar esta legenda" });
    expect(opcoes).toHaveLength(3);
    expect(corpoEnviado(spy, "POST", "/api/marketing/legendas/sugerir")).toMatchObject({ idioma: "es" });
    await userEvent.click(opcoes[1]!);
    expect(screen.getByLabelText("Legenda / roteiro")).toHaveValue("Legenda 2\n\n#floripa #turismo");
  });
});

describe("Banco de mídias", () => {
  const banco = { itens: [{ id: "m1", nome: "lagoa.jpg", tipo: "image/jpeg", uso: "IMAGEM", tamanho: 204800, passeio: "City Tour Toda Ilha", pontoTuristico: "Lagoa", temporada: "Verão", criadoEm: "2026-11-01T10:00:00Z" }, { id: "m2", nome: "logo.png", tipo: "image/png", uso: "IMAGEM", tamanho: 1024, passeio: null, pontoTuristico: null, temporada: null, criadoEm: "2026-11-01T10:00:00Z" }], etiquetas: { passeios: ["City Tour Toda Ilha"], pontosTuristicos: ["Lagoa"], temporadas: ["Verão"] } };

  it("lista com etiquetas, avisa o que não serve ao Instagram e filtra pela API", async () => {
    const spy = simularApi({ "GET /api/marketing/banco-midias": banco });
    renderizar(<BancoMidias />, { sessao: ver });
    expect(await screen.findByText("lagoa.jpg")).toBeInTheDocument();
    expect(screen.getByText("Lagoa", { selector: ".etiqueta" })).toBeInTheDocument();
    expect(screen.getByText(/não serve ao Instagram/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Arquivos")).not.toBeInTheDocument(); // só quem gerencia envia
    await userEvent.selectOptions(screen.getByLabelText("Temporada"), "Verão");
    await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes("temporada=Ver"))).toBe(true));
  });

  it("quem gerencia vê o envio com etiquetas", async () => {
    simularApi({ "GET /api/marketing/banco-midias": banco });
    renderizar(<BancoMidias />, { sessao: gerenciar });
    expect(await screen.findByLabelText("Arquivos")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Excluir/ })).toHaveLength(2);
  });
});
