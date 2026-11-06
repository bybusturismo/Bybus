import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { corpoEnviado, renderizar, sessaoFicticia, simularApi } from "../../teste/ajuda";
import { Orcamentos } from "../orcamentos/Orcamentos";
import { BioPublica } from "../publico/BioPublica";
import { NpsPublico } from "../publico/NpsPublico";
import { OrcamentoPublico } from "../publico/OrcamentoPublico";
import { Avaliacoes } from "./Avaliacoes";
import { Mensagens } from "./Mensagens";
import { Nps } from "./Nps";
import { Relatorios } from "./Relatorios";

const gerenciar = sessaoFicticia("MKT", ["marketing:ver", "marketing:gerenciar"], { todasUnidades: true });
const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

describe("NPS público", () => {
  const info = { passeio: "City Tour", data: "2026-11-05", titular: "Paula", idioma: "pt", respondido: false };
  it("exige a nota, envia nota e comentário e mostra o convite também para nota baixa que aceitou", async () => {
    const spy = simularApi({
      [`GET /api/publico/nps/${TOKEN}`]: info,
      [`POST /api/publico/nps/${TOKEN}`]: { ok: true, convite: { viator: false, canais: [{ tipo: "GOOGLE", link: "https://g.page/r/x" }] }, cupom: { codigo: "VOLTE10", texto: "Use o cupom VOLTE10." } },
    });
    renderizar(<NpsPublico token={TOKEN} />);
    expect(await screen.findByText(/Olá, Paula/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    expect(screen.getByText("Escolha uma nota de 0 a 10.")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("3"));
    await userEvent.type(screen.getByLabelText(/Quer contar mais/), "Atrasou");
    await userEvent.click(screen.getByLabelText(/Aceito receber o convite/));
    await userEvent.click(screen.getByRole("button", { name: "Enviar resposta" }));
    expect(await screen.findByText("Obrigado pela sua resposta!")).toBeInTheDocument();
    expect(corpoEnviado(spy, "POST", `/api/publico/nps/${TOKEN}`)).toEqual({ nota: 3, comentario: "Atrasou", aceitaConvite: true });
    expect(screen.getByRole("link", { name: "Avaliar no Google" })).toHaveAttribute("href", "https://g.page/r/x");
    expect(screen.getByText("Use o cupom VOLTE10.")).toBeInTheDocument();
  });
  it("quem comprou na Viator é orientado a avaliar na própria Viator", async () => {
    simularApi({ [`GET /api/publico/nps/${TOKEN}`]: { ...info, idioma: "en" }, [`POST /api/publico/nps/${TOKEN}`]: { ok: true, convite: { viator: true, canais: [] }, cupom: null } });
    renderizar(<NpsPublico token={TOKEN} />);
    await userEvent.click(await screen.findByLabelText("10"));
    await userEvent.click(screen.getByLabelText(/I agree to receive an invitation/));
    await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(await screen.findByText(/booked through Viator/)).toBeInTheDocument();
  });
  it("já respondida e link inválido", async () => {
    simularApi({ [`GET /api/publico/nps/${TOKEN}`]: { ...info, respondido: true } });
    renderizar(<NpsPublico token={TOKEN} />);
    expect(await screen.findByText("Esta pesquisa já foi respondida. Obrigado!")).toBeInTheDocument();
  });
  it("link inválido mostra a mensagem da API", async () => {
    simularApi({});
    renderizar(<NpsPublico token={TOKEN} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Rota não simulada/);
  });
});

describe("Orçamento público", () => {
  const rotas = { "GET /api/publico/orcamento/formulario": { token: "123.abc", passeios: ["City Tour"], tipos: [] }, "POST /api/publico/orcamento": { ok: true, protocolo: "ABCD1234" } };
  it("tem campo isca escondido e exige consentimento e contato", async () => {
    const spy = simularApi(rotas);
    renderizar(<OrcamentoPublico />);
    await screen.findByLabelText(/Seu nome/);
    expect(document.querySelector(".pub-isca")).toHaveAttribute("aria-hidden", "true");
    await userEvent.type(screen.getByLabelText(/Seu nome/), "Carla Fictícia");
    await userEvent.type(screen.getByLabelText(/Escola, empresa/), "Escola Modelo");
    await userEvent.type(screen.getByLabelText(/Número de pessoas/), "40");
    await userEvent.type(screen.getByLabelText(/Passeio ou serviço/), "City Tour");
    await userEvent.click(screen.getByRole("button", { name: "Pedir orçamento" }));
    expect(screen.getByText("Informe um telefone (com DDD) ou um e-mail.")).toBeInTheDocument();
    expect(screen.getByText("É preciso concordar para receber o orçamento.")).toBeInTheDocument();
    expect(spy.mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
    await userEvent.type(screen.getByLabelText(/Telefone com DDD/), "48 90000-0000");
    await userEvent.click(screen.getByLabelText(/Concordo que a By Bus/));
    await userEvent.click(screen.getByRole("button", { name: "Pedir orçamento" }));
    expect(await screen.findByText(/ABCD1234/)).toBeInTheDocument();
    const corpo = corpoEnviado(spy, "POST", "/api/publico/orcamento") as Record<string, unknown>;
    expect(corpo).toMatchObject({ nome: "Carla Fictícia", pessoas: 40, consentimento: true, formToken: "123.abc", site: "" });
  });
});

describe("Link na bio público", () => {
  it("mostra só botões https e conta o clique", async () => {
    const spy = simularApi({
      "GET /api/publico/bio": { titulo: "By Bus", subtitulo: "Passeios", corPrimaria: "#007ac8", corFundo: "#ffffff", cupom: { codigo: "ILHA10", texto: "10% off" }, botoes: [{ id: "b1", rotulo: "Reservar", url: "https://paytour.exemplo.test/x", tipo: "PAYTOUR", destaque: true }, { id: "b2", rotulo: "Ruim", url: "javascript:alert(1)", tipo: "OUTRO", destaque: false }] },
      "POST /api/publico/bio/visita": { ok: true }, "POST /api/publico/bio/clique": { ok: true },
    });
    renderizar(<BioPublica />);
    const link = await screen.findByRole("link", { name: "Reservar" });
    expect(link).toHaveAttribute("href", "https://paytour.exemplo.test/x");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText("Ruim")).not.toBeInTheDocument();
    expect(screen.getByText("ILHA10")).toBeInTheDocument();
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    await waitFor(() => expect(corpoEnviado(spy, "POST", "/api/publico/bio/clique")).toMatchObject({ botaoId: "b1" }));
  });
});

describe("Avaliações: fila", () => {
  const resumo = { notas: { quantidade: 0, media: null, distribuicao: [], porGuia: [], porCanal: [] }, pedidos: { PENDENTE: 1 }, funil: { elegiveis: 10, pedidos: 2, feitos: 5, avaliados: 1, lembretesSugeridos: 1, taxaPedidos: 50, taxaAvaliacao: 20 }, semanal: [], tripadvisor: { reservasViator: 0, passageirosViator: 0, link: null } };
  const pedido = (o: object) => ({ id: "p1", reservaId: "r1", status: "PENDENTE", texto: "Hi John! Review us", idioma: "en", canalAvaliacao: "GOOGLE", link: "https://g.page/x", data: "2026-11-04", passeio: "City Tour", canal: "PAYTOUR", temTelefone: true, lembreteSugerido: false, nps: null, pedidoEm: null, ...o });
  const base = { "GET /api/marketing/avaliacoes/resumo": resumo, "GET /api/marketing/avaliacoes/config": { modelos: { pt: "a", en: "b", es: "c" }, padroes: { pt: "a", en: "b", es: "c" }, linkTripadvisor: null, linksGoogle: [], envio: { real: false, nota: "Modo simulado: nada sai de verdade." } }, "GET /api/marketing/avaliacoes/externas": [] };
  it("mostra idioma, taxa de pedidos e envia em modo simulado", async () => {
    const spy = simularApi({ ...base, "GET /api/marketing/avaliacoes/pedidos": [pedido({}), pedido({ id: "p2", reservaId: "r2", status: "ENVIADA_MANUAL", lembreteSugerido: true, canalAvaliacao: "VIATOR", link: null })], "POST /api/marketing/avaliacoes/pedidos/p1/enviar": { status: "SIMULADA", simulado: true } });
    renderizar(<Avaliacoes />, { sessao: gerenciar });
    expect(await screen.findByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Modo simulado: nada sai de verdade.")).toBeInTheDocument();
    expect(screen.getByText("lembrete sugerido")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Idioma da mensagem")[0]).toHaveValue("en");
    expect(screen.getByText("Viator (na própria Viator)")).toBeInTheDocument();
    const linha = screen.getAllByRole("row")[1]!;
    await userEvent.click(within(linha).getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(spy.mock.calls.some(([u, i]) => String(u).endsWith("/p1/enviar") && i?.method === "POST")).toBe(true));
    expect(await screen.findByText("Simulado: nada saiu de verdade.")).toBeInTheDocument();
  });
  it("quem só vê não tem botões de ação", async () => {
    simularApi({ ...base, "GET /api/marketing/avaliacoes/pedidos": [pedido({})] });
    renderizar(<Avaliacoes />, { sessao: sessaoFicticia("MKT", ["marketing:ver"]) });
    await screen.findByText("Hi John! Review us");
    expect(screen.queryByRole("button", { name: "Enviar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gerar fila do período" })).not.toBeInTheDocument();
  });
});

describe("Orçamentos", () => {
  const o = { id: "o1", protocolo: "ABCD1234", nome: "Carla", organizacao: "Escola Modelo", tipoGrupo: "ESCOLA", telefone: null, email: null, contatosOcultos: true, dataPretendida: "2026-12-10", pessoas: 40, servico: "City Tour", cidadeOrigem: null, mensagem: null, utmSource: "instagram", utmCampaign: null, status: "NOVO", responsavelId: null, responsavel: null, anotacoes: null, anonimizado: false, criadoEm: "2026-11-05T12:00:00Z" };
  it("lista os pedidos com o contador de novos e muda a situação", async () => {
    const spy = simularApi({ "GET /api/orcamentos": [o], "GET /api/orcamentos/responsaveis": [{ id: "u9", nome: "Atendente" }], "PATCH /api/orcamentos/o1": { ok: true } });
    renderizar(<Orcamentos />, { sessao: sessaoFicticia("ATEND", ["reservas:editar"]) });
    expect(await screen.findByText("Escola Modelo")).toBeInTheDocument();
    expect(screen.getByLabelText("1 novo(s)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(await screen.findByText(/contatos visíveis só para quem pode ver contatos/)).toBeInTheDocument();
    const dialogo = screen.getByRole("dialog");
    await userEvent.selectOptions(within(dialogo).getByLabelText("Situação"), "EM_CONTATO");
    await userEvent.click(within(dialogo).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(corpoEnviado(spy, "PATCH", "/api/orcamentos/o1")).toMatchObject({ status: "EM_CONTATO" }));
  });
});

describe("NPS, mensagens e relatórios (telas internas)", () => {
  it("painel de NPS e casos internos", async () => {
    simularApi({
      "GET /api/marketing/nps": { geral: { chave: "g", total: 10, promotores: 7, neutros: 2, detratores: 1, nps: 60, enviados: 20, taxaResposta: 50, aceitaramConvite: 4 }, porMes: [{ chave: "2026-10", total: 10, promotores: 7, neutros: 2, detratores: 1, nps: 60 }], porPasseio: [{ chave: "City Tour", total: 10, promotores: 7, neutros: 2, detratores: 1, nps: 60 }], porGuia: [] },
      "GET /api/marketing/nps/casos": [{ id: "c1", reservaId: "r", nota: 3, comentario: "Atrasou", titular: "Bruno", data: "2026-11-03", passeio: "City Tour", guia: null, casoStatus: "ABERTO", casoNota: null, responsavel: null }],
    });
    renderizar(<Nps />, { sessao: gerenciar });
    expect(await screen.findByText("Atrasou")).toBeInTheDocument();
    expect(screen.getByText("Aberto")).toBeInTheDocument();
    expect(screen.getByText("60", { selector: ".indicador__valor" })).toBeInTheDocument();
    expect(screen.getByLabelText("1 aberto(s)")).toBeInTheDocument();
  });
  it("fluxos: liga e desliga, e só quem vê todas as praças edita", async () => {
    const f = (codigo: string, ligado: boolean) => ({ codigo, rotulo: codigo === "COMPRA" ? "Confirmação da compra" : "Véspera do passeio", quando: "Quando.", editavel: codigo === "COMPRA", variaveis: ["nome"], ligado, textos: { pt: "Olá {nome}", en: "Hi {nome}", es: "Hola {nome}" }, padroes: { pt: "Olá {nome}", en: "Hi {nome}", es: "Hola {nome}" }, personalizado: { pt: false, en: false, es: false }, extra: null, origemDoLigado: codigo === "VESPERA" ? "FECHAMENTO" : "VARIAVEL_DE_AMBIENTE" });
    const spy = simularApi({ "GET /api/marketing/mensagens": { envio: { real: false, nota: "Modo simulado." }, fluxos: [f("COMPRA", false), f("VESPERA", true)] }, "PATCH /api/marketing/mensagens/COMPRA": { envio: { real: false, nota: "x" }, fluxos: [f("COMPRA", true), f("VESPERA", true)] } });
    renderizar(<Mensagens />, { sessao: gerenciar });
    await userEvent.click(await screen.findByLabelText("Enviar automaticamente"));
    await waitFor(() => expect(corpoEnviado(spy, "PATCH", "/api/marketing/mensagens/COMPRA")).toEqual({ ligado: true }));
    expect(screen.getByText(/segue a configuração do servidor/)).toBeInTheDocument();
  });
  it("fluxos sem permissão total ficam só para leitura", async () => {
    simularApi({ "GET /api/marketing/mensagens": { envio: { real: false, nota: "Modo simulado." }, fluxos: [{ codigo: "COMPRA", rotulo: "Confirmação da compra", quando: "q", editavel: true, variaveis: [], ligado: true, textos: { pt: "a", en: "b", es: "c" }, padroes: { pt: "a", en: "b", es: "c" }, personalizado: { pt: false, en: false, es: false }, extra: null, origemDoLigado: "TELA" }] } });
    renderizar(<Mensagens />, { sessao: sessaoFicticia("MKT", ["marketing:ver", "marketing:gerenciar"]) });
    await screen.findByText("Confirmação da compra");
    expect(screen.queryByLabelText("Enviar automaticamente")).not.toBeInTheDocument();
    expect(screen.getByText(/Só quem enxerga todas as praças/)).toBeInTheDocument();
  });
  it("lista de relatórios mostra o aviso de IA", async () => {
    simularApi({ "GET /api/marketing/relatorios": { iaLigada: false, relatorios: [{ id: "x1", tipo: "SEMANAL", de: "2026-11-02", ate: "2026-11-08", praca: "Todas as praças", geradoEm: "2026-11-09T10:00:00Z", automatico: true, temResumoIa: false }] } });
    renderizar(<Relatorios />, { sessao: gerenciar });
    expect(await screen.findByText(/IA desligada/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", "/marketing/relatorios/x1");
  });
});
